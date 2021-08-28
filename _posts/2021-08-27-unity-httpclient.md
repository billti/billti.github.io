---
layout: post
title: HttpClient in Unity
---

On a code review of some Unity code where `HttpClient` was being used, a comment was made to
_"Consider using HttpClientFactory"_. Those three words resulted in many hours of intrigue and
frustration, which I will document here.

## Why we have HttpClientFactory

First, some background: Why does `HttpClientFactory` exist? There's a long and sordid history to this.

An (in)famous post title _"You're using HttpClient wrong and it is destabilizing your software"_ at
<https://www.aspnetmonsters.com/2016/08/2016-08-27-httpclientwrong/> outlines the first problem. Namely,
although `HttpClient` implements the `IDispose` interface, you shouldn't be spinning them up and disposing
them regularly. By default this will create new network connections for each `HttpClient` instance, and
then leave them in a TIME_WAIT state for a couple mins when disposed. Beside the fact creating new
connections is expensive (with the TCP handshake and SSL overheaded on each new connection), every
network connection you leave in this state is consuming resources, and at the extreme end you get
"socket exhaustion", where you literally run out of TCP/IP sockets to allocate.

So the outcome of that article is that you should allocate a static `HttpClient` and just continue to
use it, thus reusing the network connections is allocates. This however, results in another serious
problem as outlined in _"Singleton HttpClient? Beware of this serious behavior and how to fix it"_ at
<http://byterot.blogspot.com/2016/07/singleton-httpclient-dns.html>. Basically the problem with using
a single HttpClient and continually reusing the connections, is that DNS changes will now never get
picked up. Various performance and reliability solutions on the internet (such as 
[Azure Front Door](https://docs.microsoft.com/en-us/azure/traffic-manager/traffic-manager-overview))
use DNS changes to route clients to different endpoints depending on load and health. Some deployment
features such as A/B testing or switching staging slots can also be implemented via DNS changes.

The solution to this is to use `HttpClientFactory` to get a new `HttpClient` on demand. Under the
covers it handles persisting connections for a couple mins (even when the `HttpClient` is disposed)
and also spinning up new connections regularly to pick up any DNS changes. You can read more about
how to use it on the doc page [Use IHttpClientFactory to implement resilient HTTP requests](https://docs.microsoft.com/en-us/dotnet/architecture/microservices/implement-resilient-applications/use-httpclientfactory-to-implement-resilient-http-requests).

So just use that right?

## Unity and .NET

Unity doesn't use the "official" .NET 4.x Framework. It also doesn't use .NET Core. It's version of
.NET is from the [Mono project](https://www.mono-project.com/). (Actually a fork of this project, but
that's not important for now). As can be seen on their doc page [.NET Profile Support](https://docs.unity3d.com/Manual/dotnetProfileSupport.html),
Unity support .NET 4.x and .NET Standard 2.0 profiles. Unfortunately `HttpClientFactory` was added in
.NET Core 2.1 (which is .NET Standard 2.1).

But all is not lost. `HttpClientFactory` itself is contained in the NuGet package "Microsoft.Extensions.Http",
and if you look on NuGet at <https://www.nuget.org/packages/Microsoft.Extensions.Http/>, you can see
this supports .NET Standard 2.0. However it has a loooooong dependency graph, depending on other packages
for Logging, Options, DependencyInjection, etc. Beside the pain of getting NuGet packages into a Unity
application, requiring the manual download and unzipping of packages (see this [documentation page](https://docs.microsoft.com/en-us/visualstudio/gamedev/unity/unity-scripting-upgrade#add-packages-from-nuget-to-a-unity-project)),
there is another pain point.

### HttpClientFactory and DI

The only way to use `HttpClientFactory` is via dependency injection, which also requires you to use
the .NET hosting model. The __only__ way to get an `IHttpClientFactory` interface (needed to create
the `HttpClient` instances) is via dependency injection, by calling the extension method `AddHttpClient`
on an `IServiceCollection`, and then having the hosting model create the instances where it is needed.

You can see on the GitHub issue at <https://github.com/aspnet/HttpClientFactory/issues/55> where ways
to use `HttpClientFactory` without depending on Dependency Injection and the associated hosting model
have been requested, but at the moment that is still required.

I did not want to add a long list of NuGet packages and restructure the Unity app to use an IServiceProvider
and Dependency Injection, so `HttpClientFactory` was off the table.

### Mono thwarts other avenues

If we revisit the Uber-issue on GitHub, and specifically [this comment](https://github.com/dotnet/runtime/issues/18348#issuecomment-415845645)
you'll notice the below:

<img src="/assets/images/mono-ConnectionLeaseTimeout.png"/>

Notice the _"..not working reliably across platforms.."_ bit. Sadly, Mono is one of those platforms. Using
ILSpy on the Mono version of `System.Net.Http.dll` versus the other .NET implementations, it can been seen
there are many things that are simply not implemented. Sadly, `ConnectionLeaseTimeout` is one of them.

<img src="/assets/images/mono-ilspy.png"/>

This left but one option: Figure out how all this fits together and write a custom solution.

## How HttpClient works in Mono

The `HttpCient` class itself doesn't create and destroy network connections. The class relationships
that map between an `HttpClient` instance and a network socket is very convoluted. I ended up mapping
out and diagramming over 20 class types, and that was just to get a high level understanding. The crux
of the issue though is that `HttpClient` is a very thin wrapper, and delegates much of its work to
`HttpClientHandler`, which creates a network connection "group". When you create a new `HttpClient`
via its default constructor, it creates its own `HttpClientHandler`, and then when you call `Dispose()`
on this `HttpClient`, it calls `Dispose()` on its `HttpClientHandler`, which closes the network connection
group. You can see this code at [this line in the Unity Mono fork](https://github.com/Unity-Technologies/mono/blob/2020.3.9f1/mcs/class/System.Net.Http/System.Net.Http/HttpClientHandler.cs#L230)

`HttpClient` itself largely just delegates to `HttpMessageInvoker`, and it can be seen from its constructor
that you can provider an `HttpMessageHandler` (which `HttpClientHandler` derives from), and also tell
it not to dispose this message handler when it is disposed. This is the key to sharing connections
across `HttpClient` instances.

So that seemed easy enough. Just create all the `HttpClient` instances using one `HttpClientHandler`
for a couple mins to share the connections, then periodically start using a new `HttpClientHandler` to
cycle through the connections and pick up DNS changes. (This is effectively what `HttpClientFactory` does).

But that then left me with a few questions, namely:

- So when should the `HttpMessageHandler` be disposed? How do you know when its connections are no
  longer in use (i.e. requests/responses have completed). You don't want to kill the connections while
  requests are still in progress.
- If I return just the response stream from a method, and the `HttpClient` is diposed, and the active
  `HttpClientHandler` has been replaced, will garbage collection potentially run and kill the
  (possibly in flight) connections?

### Cut to the chase

Long story short, while calling `Dispose()` explicitly on the `HttpClientHandler` kills the connection
group, that class doesn't have a finalizer (a destructor, in C# parlance). So when the garbage collector
cleans up an `HttpClientHandler`, no code is invoked, and `Dipose(false)` is not called to clean up
unmanaged resources.

The connections themselves are managed by a `ServicePointScheduler`, which tracks when an operation
completes on a connection and will then close it when idle. See [this code in the Mono repository](https://github.com/mono/mono/blob/mono-6.12.0.151/mcs/class/System/System.Net/ServicePointScheduler.cs#L223)

This allows for both the `HttpClient` to be disposed (which doesn't dispose the provided `HttpClientHandler`),
and for the `HttpClientHandler` to be garbage collected when no longer referenced, without killing any
in use connections. The `ServicePoint` manages the active connections, and will clean them up when no longer used.

This allows for code such as the below, which returns only a stream, and the connection will remain
active until the response is completed, even after the `HttpClient` and the underlying `HttpClientHandler`
have long gone.

```csharp
    async Task<Stream> GetHttpStream()
    {
        using var client = UnityHttpClient.Get();
        var stream = await client.GetStreamAsync("https://localhost:5001/api/blob");
        return stream;
    }
```

Using the excellent [Memory Profilers Package](https://docs.unity3d.com/Packages/com.unity.memoryprofiler@0.2/manual/index.html)
in Unity, from the stream returned above, we can see it reference down to the underlying network socket.
Also shown in the `ServicePoint` which holds a reference to outstanding operations and current network
connections, (as well as idle connections to be cleaned up after the idle timeout). References
of interest have been underlined.

<img src="/assets/images/unity-memory.png" width="1000px"/>


## Writing the Unity HttpClient factory

With the above in mind, how should an `HttpClientFactory` for Unity look. Below is the
implementation I came up with. Note this allows for a "named" clients to explicitly get
a new set of connections (as outlined in the comments).

```csharp
public class UnityHttpClient
{
    private const int handlerExpirySeconds = 120;
    private static readonly object factoryLock = new object();

    private static readonly Dictionary<string, UnityHttpClient> factories = new Dictionary<string, UnityHttpClient>()
    {
        { string.Empty, new UnityHttpClient() }
    };

    public static HttpClient Get() => factories[string.Empty].GetNewHttpClient();

    // Each unique HttpClientHandler gets a new Connection limit per origin, so create a new "named" client
    // factory to get a new handler (used by each HttpClient from that factory), and thus new set of connections.
    //
    // For example, if you have a few long-running requests, you might choose to put them on their own
    // handler/connections so you don't block other faster requests to the same host.
    public static HttpClient Get(string name)
    {
        UnityHttpClient factory;
        lock (factoryLock)
        {
            if (!factories.TryGetValue(name, out factory))
            {
                factory = new UnityHttpClient();
                factories.Add(name, factory);
            }
        }
        return factory.GetNewHttpClient();
    }

    private HttpClientHandler _currentHandler = new HttpClientHandler();
    private readonly Stopwatch _handlerTimer = new Stopwatch();
    private readonly object _handlerLock = new object();

    private UnityHttpClient() { }

    private HttpClient GetNewHttpClient() => new HttpClient(GetHandler(), disposeHandler: false);

    private HttpClientHandler GetHandler()
    {
        lock(_handlerLock)
        {
            if (_handlerTimer.Elapsed.TotalSeconds > handlerExpirySeconds)
            {
                // Leave the old HttpClientHandler to the GC to clean up. DON'T Dispose() it!
                _currentHandler = new HttpClientHandler();
                _handlerTimer.Restart();
            }
            return _currentHandler;
        }
    }
}
```

## TODO

- Show the network sockets over time being kept to a minimum with many requests.
- Show DNS changes getting picked up.
- Show putting slow connections on one named group/handlers, fast on another,
  which means the slow requests will never block the fast (unlike with all on default connections).
