---
layout: post
title: HttpClient in Unity
---

On a code review of some Unity code where `HttpClient` was being used, a comment was made to
_"Consider using HttpClientFactory"_. Those three words resulted in many hours of intrigue and
frustration, which I will document here.

## Why we have HttpClientFactory

First, some background: Why does `HttpClientFactory` exist? There's a long and sordid history to this.

An (in)famous post titled _"You're using HttpClient wrong and it is destabilizing your software"_ at
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
covers it handles persisting connections for a couple of minutes (even when the `HttpClient` is disposed)
and also spinning up new connections regularly to pick up any DNS changes. You can read more about
how to use it on the doc page [Use IHttpClientFactory to implement resilient HTTP requests](https://docs.microsoft.com/en-us/dotnet/architecture/microservices/implement-resilient-applications/use-httpclientfactory-to-implement-resilient-http-requests).

So just use that right?

## Unity and .NET

_(Note: My specific Unity project is using the .NET 4.x profile, so those are the APIs this post will cover)_

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
there are many things that are simply not implemented. Sadly, `ServicePoint.ConnectionLeaseTimeout` is one of them.

<img src="/assets/images/mono-ilspy.png" width="262px"/>

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

Effectively `HttpClient` and `HttpClientHandler` are just factories to create `HttpResponseMessage`
objects (and corresponding `HttpRequestMessage`) against a specific `ConnectionGroup`. They do not
hold any references to these objects, and refer to the `ConnectionGroup` by name only, as seen below.

<img src="/assets/images/mono-httpclienthandler.png" width="652px"/>

As long as you don't explicitly `Dispose` the underlying `HttpClientHandler`, but instead provide your
own and simply stop using it and leave to the GC to clean up when done, all is good.

This allows for both the `HttpClient` to be disposed (which doesn't dispose the provided `HttpClientHandler`),
and for the `HttpClientHandler` to be garbage collected when no longer referenced, without killing any
in use connections. The `ServicePoint` manages the active connections, and will clean them up when no longer used.

Implmenting a `UnityHttpClient` with this approach allows for code such as the below, which returns only a stream, and the connection will remain
active until the response is completed, even after the `HttpClient` and the underlying `HttpClientHandler`
have long gone. The class will start using a new `HttpClientHandler` periodically to allocate new connections.

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
Also shown is the `ServicePoint` which holds a reference to outstanding operations and current network
connections, (as well as idle connections to be cleaned up after the idle timeout). References
of interest have been underlined.

<img src="/assets/images/unity-memory.png"/>


## Writing the Unity HttpClient factory

With the above in mind, how should the `UnityClientFactory` look? Below is the
implementation I came up with. Note this allows for "named" clients to explicitly get
a new set of connections (as outlined in the comments).

```csharp
public class UnityHttpClient
{
    private const int handlerExpirySeconds = 120;
    private static readonly object factoryLock = new object();

    private static readonly Dictionary<string, UnityHttpClient> factories =
            new Dictionary<string, UnityHttpClient>()
            {
                { string.Empty, new UnityHttpClient() }
            };

    public static HttpClient Get() => factories[string.Empty].GetNewHttpClient();

    // Each unique HttpClientHandler gets a new Connection limit per origin, so create
    // a new "named" client factory to get a new handler (used by each HttpClient from
    // that factory), and thus new set of connections.
    //
    // For example, if you have a few long-running requests, you might choose to put
    // them on their own handler/connections so you don't block other faster requests
    // to the same host.
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

    private HttpClient GetNewHttpClient() =>
            new HttpClient(GetHandler(), disposeHandler: false);

    private HttpClientHandler GetHandler()
    {
        lock(_handlerLock)
        {
            if (_handlerTimer.Elapsed.TotalSeconds > handlerExpirySeconds)
            {
                // Leave the old HttpClientHandler for the GC. DON'T Dispose() it!
                _currentHandler = new HttpClientHandler();
                _handlerTimer.Restart();
            }
            return _currentHandler;
        }
    }
}
```

## Testing

To verify the code behaves as desired, I created a simple web service that has two REST APIs. The
first `/api/item` generates small and fast responses, and the second `/api/blob` for large and slow
responses. This simple web server can be written in a few lines of C# code using top-level statements
(as introduced in C# 9). The entire ASP.NET Core 5 project code is shown below:

```csharp
using System;
using System.Diagnostics;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Hosting;

int requestId = 0;

var builder = Host.CreateDefaultBuilder().ConfigureWebHostDefaults(webBuilder =>
{
    webBuilder.Configure(app =>
    {
        // Fast and small JSON response
        app.Map("/api/item", app =>
        {
            app.Run(async context =>
            {
                int itemId = Interlocked.Increment(ref requestId);
                byte[] body = Encoding.UTF8.GetBytes($"{{\"itemId\" : {itemId}}}");

                context.Response.StatusCode = 200;
                context.Response.ContentLength = body.Length;
                context.Response.ContentType = "application/json";

                await context.Response.BodyWriter.WriteAsync(body.AsMemory());
                await context.Response.CompleteAsync();
            });
        });

        // Large and slow binary response
        app.Map("/api/blob", app =>
        {
            app.Run(async context =>
            {
                Stopwatch chunkTimer = Stopwatch.StartNew();
                const int contentLength = 1024 * 1024 * 10; // 10 MB
                const int chunkSize = 1024 * 16;            // in 16kb chunks
                const int responseTimeMs = 10000;           // Response to take 10 sec

                Debug.Assert(chunkSize % 128 == 0 && contentLength % chunkSize == 0,
                  "chunkSize must be multiple of 128 and divide into contentLength");

                context.Response.StatusCode = 200;
                context.Response.ContentLength = contentLength;
                context.Response.ContentType = "application/octet-stream";

                int bytesWritten = 0;
                while (bytesWritten < contentLength)
                {
                    StringBuilder content = new(chunkSize);
                    while (content.Length < chunkSize)
                    {
                        string txt = $"{bytesWritten + 128} bytes including this line"
                            .PadRight(127, '-') + "\n";
                        content.Append(txt);
                        bytesWritten += 128;
                    }
                    byte[] chunk = Encoding.UTF8.GetBytes(content.ToString());
                    Debug.Assert(chunk.Length == chunkSize);

                    await context.Response.BodyWriter.WriteAsync(chunk.AsMemory());

                    // Delay each chunk so the request takes the desired time
                    double percentComplete = (double)bytesWritten / contentLength;
                    long durationSoFarMs = chunkTimer.ElapsedMilliseconds;
                    int delayMs =
                            (int)(percentComplete * responseTimeMs - durationSoFarMs);
                    if (delayMs > 0) await Task.Delay(delayMs);
                }

                await context.Response.CompleteAsync();
            });
        });
    });
});

builder.Build().Run();
```

## Using dedicated connections

Below shows the code to test the service. Of particular interest are lines 6 & 7, where the requests
to the large and slow endpoint can either use the default handler, or be configured with their own
handler. For the initial tests we'll put everything on the same handler.

This code sends a new request every second. Note the condition `if (reqId % 3 == 0) {...}` that
causes every third request to be to the slow API.

```csharp
public class MyDownloader : MonoBehaviour
{
    async Task<Stream> GetHttpStream()
    {
        // *** Switch which line is commented out below to use a dedicated handler ***
        // using var client = UnityHttpClient.Get("slow");
        using var client = UnityHttpClient.Get();

        var stream = await client.GetStreamAsync("https://localhost:5001/api/blob");
        return stream;
    }

    async Task<HttpResponseMessage> GetHttpRequest()
    {
        using var client = UnityHttpClient.Get();
        var req = await client.GetAsync("https://localhost:5001/api/item");
        if (req.StatusCode != System.Net.HttpStatusCode.OK)
        {
            throw new ApplicationException("Error");
        }
        return req;
    }

    bool doRequests = false;
    int requestId = 0;
    Stopwatch timer;

    void Start()
    {
        LogMsg($"Starting downloader.");
        timer = Stopwatch.StartNew();
    }

    void LogMsg(string msg) =>
        Debug.Log(msg + $" ThreadId: {Thread.CurrentThread.ManagedThreadId}");

    void Update()
    {
        if (!doRequests) return;

        // Every second start a new request
        if (timer.ElapsedMilliseconds >= 1000)
        {
            timer.Restart();
            int reqId = Interlocked.Increment(ref requestId);
            Task.Run(async () =>
            {
                if (reqId % 3 == 0)
                {
                    // One in three requests is for a large/slow item.
                    Debug.Log($"Request {reqId} starting for slow blob. " +
                            $"ThreadId: {Thread.CurrentThread.ManagedThreadId}");

                    var stream = await GetHttpStream();

                    // On a separate thread, read the stream to completion.
                    _ = stream.CopyToAsync(Stream.Null).ContinueWith(_ =>
                          LogMsg($"Request {reqId} completed for slow blob."));
                }
                else
                {
                    LogMsg($"Request {reqId} starting for fast json.");
                    var request = await GetHttpRequest();
                    LogMsg($"Request {reqId} completed for fast json.");
                }
            });
        }
    }

    void OnMouseDown()
    {
        doRequests = !doRequests;
    }
}
```

Running this code as-is we can see that pretty soon even the "_quick_" requests are getting backed up
waiting for the slow requests to complete. The initial "fast" requests number 1, 2, 4, and 5 all
complete within the expect 1 sec time. But once the second "slow" request starts (request 6), we see
that all requests start taking a while to complete, as the two connections per origin limit is
consumed with running the slow requests.

#### Log with one handler
<img src="/assets/images/unity-requests-one-handler-log.png" width="401px"/>

If we look at the object in memory, we can see in the scheduler that the default two connections are
allocated, and there are a queue of operations waiting to run.

#### Objects with one handler
<img src="/assets/images/unity-requests-one-handler-memory.png"/>

### Adding an additional handler

If we uncomment line 6 and comment out line 7, so that `GetHttpStream` is using its own dedicated
handler group (named "slow"), we see that now all the fast API requests are completing immediately,
even as the slow API requests start to queue up.

#### Log with slow handler
<img src="/assets/images/unity-requests-slow-handler-log.png" width="390px"/>

The objects in memory show us that there are now two `ConnectionGroup` objects contained within the
`ServicePointScheduler`, and that the group named `HttpClientHandler1` (the first group created for
the fast requests) has an emtpy queue - even with slow requests waiting. Meanwhile the group created
for the slow requests, `HttpClientHandler2`, has a couple items in the queue (as well as operations
currently in progress).

#### Objects with slow handler
<img src="/assets/images/unity-requests-slow-handler-memory.png"/>

This shows that being able to provide a "named" connection group can avoid contention and blocking
for requests on other groups.

<!--
## TODO

- How does this interact with the Unity API for downloading assets.
  - See <https://docs.unity3d.com/2020.1/Documentation/Manual/UnityWebRequest-DownloadingAssetBundle.html>
- Show the network sockets over time being kept to a minimum with many requests.
- Show DNS changes getting picked up.
- Discuss connection limits to a specific service, and ServicePoint settings.
-->
