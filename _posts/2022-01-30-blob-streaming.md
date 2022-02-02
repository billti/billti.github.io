---
layout: post
title: Streaming large blobs through ASP.NET
---

Recently I spent way too much time with a colleague digging into an issue that occurred on one of our
services that serves largely static content through an ASP.NET Core service. The service is required
and an intermediary in order to check authentication and do some other logic. It had been working fine
for months with the assets we had, but suddenly starting failing with some larger downloads.

On further inspection, it was noticed that it was failing on assets over 8MB, which up to recently
all our assets had been smaller than. When we pointed directly at the ASP.NET origin server instead
of through the CDN, the downloads also worked fine.

The CDN in use is Azure Front Door. After some digging around in the docs, we found the below comments
on the page at <https://docs.microsoft.com/en-us/azure/cdn/cdn-large-file-optimization> for the Azure
CDN from Microsoft (which we use).

_Azure CDN Standard from Microsoft uses a technique called object chunking. When a large file is
requested, the CDN retrieves smaller pieces of the file from the origin. After the CDN POP server
receives a full or byte-range file request, the CDN edge server requests the file from the origin in
chunks of 8 MB...._

_...This optimization relies on the ability of the origin server to support byte-range requests; if
the origin server doesn't support byte-range requests, requests to download data greater than 8mb size will fail._

The last word seemed to identify the issue. This was a surprising find. If you read about the feature
on that page for other Azure CDN caches, such as the Akamai one, you find statements such as:

_This optimization relies on the ability of the origin server to support byte-range requests; if the
origin server doesn't support byte-range requests, this optimization isn't effective._

That's what I'd expect. Fall back to unoptimized behavior, not just fail a perfectly valid request!

Anyways, getting to a satisfactory resolution required quite a bit of research, and digging into some
ASP.NET internals and nuances of the HTTP specs. This is a long write-up, as it's the second time I've had
to wrestle with this topic, so there's a good chance I'll need it as a future reference. Hopefully you
can find some valuable or interesting information here too. (Else just skip to the end for the code!)

# HTTP Range Requests

So how do we update the server to support HTTP Range requests per the RFC
linked to at <https://httpwg.org/specs/rfc7233.html>. (If you are not familiar with Range requests,
the page at <https://developer.mozilla.org/en-US/docs/Web/HTTP/Range_requests> gives a good overview.
Read that then come back).

Firstly, out of the box ASP.NET Core does support range requests. It does have some minor limitation.
For example, it does not support requesting multiple ranges in one request, such as "Range: bytes=0-50, 100-150".
This is valid per the spec, but ASP.NET Core only supports requesting a single range. See the code in
[RangeHelper.cs](https://github.com/dotnet/aspnetcore/blob/release/6.0/src/Shared/RangeHelper/RangeHelper.cs#L48) which contains:

```csharp
    if (rawRangeHeader.Count > 1 || rawRangeHeader[0].IndexOf(',') >= 0)
    {
        logger.LogDebug("Multiple ranges are not supported.");

        // The spec allows for multiple ranges but we choose not to support them because the client may request
        // very strange ranges (e.g. each byte separately, overlapping ranges, etc.) that could negatively
        // impact the server. Ignore the header and serve the response normally.
        return (false, null);
    }
```

If we spin up a simple static site with code such as the below: (_No, seriously, this is ALL the code
you need to write a web server with ASP.NET Core 6!_)

```csharp
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddControllers();
var app = builder.Build();
app.UseStaticFiles();
app.Run();
```

I then dropped a file at `./wwwroot/large.txt` which is just a million lines of text, each 32 bytes
long, with text stating the current line number.

Using Postman to make a Range request starting on line 1001 (i.e., starting 32000 bytes in) for the
next 1024 bytes (which equals 32 lines), we see a request/response as shown below.

```txt
GET /large.txt HTTP/1.1
Range: bytes=32000-33023
Accept: */*
Cache-Control: no-cache
Host: localhost:7098
Accept-Encoding: gzip, deflate, br
Connection: keep-alive
 
HTTP/1.1 206 Partial Content
Content-Length: 1024
Content-Type: text/plain
Date: Sat, 29 Jan 2022 05:58:46 GMT
Server: Kestrel
Accept-Ranges: bytes
Content-Range: bytes 32000-33023/32000000
ETag: "1d814d51dc99300"
Last-Modified: Sat, 29 Jan 2022 05:57:34 GMT
 
1001 is the current line
1002 is the current line
1003 is the current line
...
1031 is the current line
1032 is the current line
```

All good. Should I change the range header to include multiple ranges, we can verify this isn't supported
and it simply returns the whole file as if no range was requested.

```txt
GET /large.txt HTTP/1.1
Range: bytes=32000-33023,64000-64100
Accept: */*
Cache-Control: no-cache
Host: localhost:7098
Accept-Encoding: gzip, deflate, br
Connection: keep-alive
 
HTTP/1.1 200 OK
Content-Length: 32000000
Content-Type: text/plain
Date: Sat, 29 Jan 2022 06:04:55 GMT
Server: Kestrel
Accept-Ranges: bytes
ETag: "1d814d51dc99300"
Last-Modified: Sat, 29 Jan 2022 05:57:34 GMT
 
1 is the current line         
2 is the current line         
3 is the current line
...
999999 is the current line    
1000000 is the current line   
```

Getting a `200 OK` rather than a `206 Partial Content` is perfectly valid per the spec, which states:

_Range requests are an OPTIONAL feature of HTTP, designed so that recipients not implementing this
feature (or not supporting it for the target resource) can respond as if it is a normal GET request
without impacting interoperability._

## Sending the file contents

Digging through the [ASP.NET Core 6 code](https://github.com/dotnet/aspnetcore/tree/release/6.0),
we can see static files are served by the `StaticFileMiddleware` class in `src\Middleware\StaticFiles\src\StaticFileMiddleware.cs`.
The meat of the work happens in method `StaticFileContext::ServeStaticFile` at `src\Middleware\StaticFiles\src\StaticFileContext.cs`.

To send the actual file we end up `StaticFileContext::SendRangeAsync`. Here it has some more interesting
notes regarding behavior if the range is not satisfiable. Namely, the `Content-Range` header in the error response
should include an asterisk and the content length.

```csharp
// 14.16 Content-Range - A server sending a response with status code 416 (Requested range not satisfiable)
// SHOULD include a Content-Range field with a byte-range-resp-spec of "*". The instance-length specifies
// the current length of the selected resource.  e.g. */length
ResponseHeaders.ContentRange = new ContentRangeHeaderValue(_length);
ApplyResponseHeaders(StatusCodes.Status416RangeNotSatisfiable);
```

For satisfiable ranges, after computing the ranges there it effectively ends up calling:

```csharp
await _context.Response.SendFileAsync(_fileInfo, start, length, _context.RequestAborted);
```

This ends up in `SendFileResponseExtensions.SendFileAsyncCore` in `src\Http\Http.Extensions\src\SendFileResponseExtensions.cs`
and calling:

```csharp
var sendFile = response.HttpContext.Features.Get<IHttpResponseBodyFeature>()!;

try
{
    await sendFile.SendFileAsync(fileName, offset, count, localCancel);
}
```

Which then ends up in `SendFileAsync` in `src\Http\Http\src\SendFileFallback.cs` which does a basic
File stream operation to the Kestrel response stream (the variable `destination` below) with a 16KB
buffer, after seeking to the range offset.

```csharp
const int bufferSize = 1024 * 16;

var fileStream = new FileStream(
    filePath,
    FileMode.Open,
    FileAccess.Read,
    FileShare.ReadWrite,
    bufferSize: bufferSize,
    options: FileOptions.Asynchronous | FileOptions.SequentialScan);

using (fileStream)
{
    fileStream.Seek(offset, SeekOrigin.Begin);
    await StreamCopyOperationInternal.CopyToAsync(fileStream, destination, count, bufferSize, cancellationToken);
}
```

When the await on the last statement above completes, the response has been sent. Everything unwinds
and the streams (file and response) are disposed.

So your generic static file serving works fine for HTTP range requests. But we weren't serving static
files. Our service fetches a blob from Azure Blob Storage and pipes it back to the client. How should this work?

# Streaming Azure Blob Range-Requests

First we need to add the Azure Blob Storage NuGet package. We were using version 12.9.1, so the .csproj
file contains:

```xml
<PackageReference Include="Azure.Storage.Blobs" Version="12.9.1" />
```

Now to add the ASP.NET Core controller endpoints to return the blob content. The `program.cs` is
updated with two additional lines to look like the below:

```csharp
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddControllers();
var app = builder.Build();
app.UseStaticFiles();
app.MapControllers();
app.Run();
```

And add a `Controller.cs` file with the below contents:

```csharp
using Microsoft.AspNetCore.Mvc;

[ApiController]
public class Controller : ControllerBase
{
    [HttpGet("/asset")]
    public IActionResult GetAsset()
    {
        return Ok("testing");
    }
}
```

If you run a PostMan request for `/asset` now, you should see network traffic such as:

```txt
GET /asset HTTP/1.1
Accept: */*
Cache-Control: no-cache
Host: localhost:7098
Accept-Encoding: gzip, deflate, br
Connection: keep-alive
 
HTTP/1.1 200 OK
Content-Type: text/plain; charset=utf-8
Date: Sat, 29 Jan 2022 07:28:01 GMT
Server: Kestrel
Transfer-Encoding: chunked
 
testing
```

It's interesting to note that without the `Content-Length` header being set, it defaults to
`Transfer-Encoding: chunked`, which makes sense.

Now update the controller to return a file fetched from Azure Blob Storage. To start with, we'll use
the most rudimentary approach possible of downloading it all into memory synchronously and then
returning it. Update `Controller.cs` to contain the below. (You `appsettings.json`, or preferably `secrets.json`,
should contain a `BlobUri` setting with the connection string for your Azure Blob Storage account):

```csharp
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Specialized;
using Microsoft.AspNetCore.Mvc;

[ApiController]
public class Controller : ControllerBase
{
    BlobContainerClient blobContainerClient;

    public Controller(IConfiguration config)
    {
        string blobUri = config.GetValue<string>("BlobUri");
        blobContainerClient = new BlobContainerClient(blobUri, "assets");
    }

    [HttpGet("/asset")]
    public IActionResult GetAsset()
    {
        var blobClient = blobContainerClient.GetBlockBlobClient("medium.txt");
        var content = blobClient.DownloadContent();
        Response.ContentType = "text/plain";
        return Ok(content.Value.Content.ToStream());
    }
}
```

Then request "https://localhost:7098/asset" in Postman (or the browser) and verify it works. (Note: 
Here I have uploaded a 'medium.txt' file which is 1000 lines (32,000 bytes) for easier testing, as
the 32MB responses tend to make some tools a little slow to work with. This I put into a container
named `assets` on the Azure Storage account).

Great. So how about requesting a range? Let's try.
```txt
GET https://localhost:7098/asset HTTP/1.1
Range: bytes=1024-2047
Accept: */*
Cache-Control: no-cache
Host: localhost:7098
Accept-Encoding: gzip, deflate, br
Connection: keep-alive


HTTP/1.1 200 OK
Content-Type: text/plain
Date: Sat, 29 Jan 2022 17:37:09 GMT
Server: Kestrel
Transfer-Encoding: chunked

7d00
1 is the current line         
2 is the current line         
...
999 is the current line       
1000 is the current line      

0

```

Here we can see it is just fetching the entire blob are returning it. The controller needs to return
a File with a stream that is seekable in order to be able to satify a request for a range within in.
Change the controller method to just the below:

```csharp
[HttpGet("/asset")]
public IActionResult GetAsset()
{
    var blobClient = blobContainerClient.GetBlockBlobClient("medium.txt");
    var content = blobClient.DownloadContent();
    return File(content.Value.Content.ToStream(), "text/plain", enableRangeProcessing: true);
}
```

Now we see the expect request/response for just a portion of the blob!

```txt
GET https://localhost:7098/asset HTTP/1.1
Range: bytes=1024-2047
Accept: */*
Cache-Control: no-cache
Host: localhost:7098
Accept-Encoding: gzip, deflate, br
Connection: keep-alive


HTTP/1.1 206 Partial Content
Content-Length: 1024
Content-Type: text/plain
Date: Sat, 29 Jan 2022 18:19:00 GMT
Server: Kestrel
Accept-Ranges: bytes
Content-Range: bytes 1024-2047/32000

33 is the current line        
34 is the current line        
...
63 is the current line        
64 is the current line        
```

The `File` class being returned by the controller here is ultimately using much of the same code as
the static file middleware uses. It effectively expects to be given a seekable stream, and if range
processing is enabled, will use the headers in the request to figure out the correct partial response
to return. Neat!

## Remaining problems

This still has many problems however. Chief amonst them being that the method is synchronously downloading
the entire blob from storage, no matter how small a range we are requesting. Using Fiddler to observe
traffic to blob storage, we see the below for the above range request. (I'll show all headers here,
but trim them for later examples).

```txt
GET https://example.blob.core.windows.net/assets/medium.txt HTTP/1.1
Host: example.blob.core.windows.net
x-ms-version: 2020-08-04
Accept: application/xml
x-ms-client-request-id: 7dda7476-1f79-4ee7-9a44-f75572772f2e
x-ms-return-client-request-id: true
User-Agent: azsdk-net-Storage.Blobs/12.9.1 (.NET 6.0.1; Microsoft Windows 10.0.19044)
x-ms-date: Sat, 29 Jan 2022 18:19:00 GMT
Authorization: SharedKey bi...0=


HTTP/1.1 200 OK
Content-Length: 32000
Content-Type: text/plain
Content-MD5: LLqzda6Tv79dBTuN6Bi7Aw==
Last-Modified: Sat, 29 Jan 2022 08:02:17 GMT
Accept-Ranges: bytes
ETag: "0x8D9E2FDAB6167FD"
Server: Windows-Azure-Blob/1.0 Microsoft-HTTPAPI/2.0
x-ms-request-id: 90018034-b01e-002e-2f3c-15ff8c000000
x-ms-client-request-id: 7dda7476-1f79-4ee7-9a44-f75572772f2e
x-ms-version: 2020-08-04
x-ms-creation-time: Sat, 29 Jan 2022 08:02:17 GMT
x-ms-lease-status: unlocked
x-ms-lease-state: available
x-ms-blob-type: BlockBlob
x-ms-server-encrypted: true
Date: Sat, 29 Jan 2022 18:19:00 GMT

1 is the current line         
2 is the current line         
...
999 is the current line       
1000 is the current line      
```

Also, this route makes no distinction for a HEAD request, (which it currently doesn't support, but
we'll fix that next), which would also fetch the entire blob, even though no content would be returned.

We could weave the HEAD logic in with the GET logic, but it's quite distinct, so it's cleaner just
to separate it out into its own method. Per the spec, it doesn't need to handle `Range` requests any
differently to a non-Range request.

```csharp
[HttpHead("/asset")]
public async Task<IActionResult> HeadAsset()
{
    var blobClient = blobContainerClient.GetBlockBlobClient("medium.txt");
    var props = await blobClient.GetPropertiesAsync();

    Response.Headers.ContentLength = props.Value.ContentLength;
    Response.Headers.ContentType = props.Value.ContentType;
    Response.Headers.AcceptRanges = "bytes";

    return Ok();
}
```

Using Fiddler we see the request and response as expected:

```txt
HEAD https://localhost:7098/asset HTTP/1.1
Accept: */*
Cache-Control: no-cache
Host: localhost:7098
Accept-Encoding: gzip, deflate, br
Connection: keep-alive


HTTP/1.1 200 OK
Content-Length: 32000
Content-Type: text/plain
Date: Sat, 29 Jan 2022 21:15:44 GMT
Server: Kestrel
Accept-Ranges: bytes
```

And importantly, the entire response from Blob storage for the `GetProperties` API is just a few headers:

```txt
HEAD https://example.blob.core.windows.net/assets/medium.txt HTTP/1.1
Host: example.blob.core.windows.net
x-ms-version: 2020-08-04
Accept: application/xml
User-Agent: azsdk-net-Storage.Blobs/12.9.1 (.NET 6.0.1; Microsoft Windows 10.0.19044)
Authorization: SharedKey bi...4=


HTTP/1.1 200 OK
Content-Length: 32000
Content-Type: text/plain
Content-MD5: LLqzda6Tv79dBTuN6Bi7Aw==
Last-Modified: Sat, 29 Jan 2022 08:02:17 GMT
Accept-Ranges: bytes
ETag: "0x8D9E2FDAB6167FD"
Server: Windows-Azure-Blob/1.0 Microsoft-HTTPAPI/2.0
x-ms-version: 2020-08-04
x-ms-creation-time: Sat, 29 Jan 2022 08:02:17 GMT
... <a few other x-ms-* headers, but no body> ...
```

Now onto the real challenge. Efficiently and correctly streaming the blob contents, including range-requests.

Let's have a first attempt:

```csharp
[HttpGet("/asset")]
public async Task<IActionResult> GetAsset(CancellationToken ct)
{
    // Tell the client we accept range-requests
    Response.Headers.AcceptRanges = "bytes";

    var blobClient = blobContainerClient.GetBlockBlobClient("medium.txt");

    var ranges = Request.GetTypedHeaders().Range?.Ranges;

    // If it's not a range request, or an unsupported one, just return the entire asset
    // We support only one range that must have a start position
    if (ranges == null || ranges.Count != 1 || !ranges.First().From.HasValue)
    {
        // Be sure to pass the cancellation token so the blob request is aborted if this request is.
        var blob = await blobClient.DownloadStreamingAsync(cancellationToken: ct);
        return File(blob.Value.Content, blob.Value.Details.ContentType);
    }
    else 
    {
        // Calculate the range to request from blob storage
        RangeItemHeaderValue range = ranges.First();
        long? length = range.To.HasValue ? range.To.Value - range.From!.Value + 1 : null;
        Azure.HttpRange azureRange = new (range.From!.Value, length);

        var blob = await blobClient.DownloadStreamingAsync(range: azureRange, cancellationToken: ct);
        // TODO: Handle errors such as out of range

        return File(blob.Value.Content, blob.Value.Details.ContentType, enableRangeProcessing: true);
    }
}
```

In requesting a range from 1024-2047 I can see the underlying blob storage request was perfect

```txt
HTTP/1.1 206 Partial Content
Content-Length: 1024
Content-Type: text/plain
Content-Range: bytes 1024-2047/32000
Accept-Ranges: bytes
Date: Sat, 29 Jan 2022 21:58:03 GMT

33 is the current line        
34 is the current line        
...
63 is the current line        
64 is the current line      
```

However the response to the request from the controller was a `200 OK`, not a `206 Partial`, which
is incorrect.

```txt
GET https://localhost:7098/asset HTTP/1.1
Range: bytes=1024-2047
Connection: keep-alive


HTTP/1.1 200 OK
Content-Type: text/plain
Accept-Ranges: bytes
Transfer-Encoding: chunked

400
33 is the current line        
34 is the current line        
...      
63 is the current line        
64 is the current line        

0
```

Also, what we can't do is assume that if we make a range-request, that we only get that range back. Per the
spec, it's perfectly valid for the server it ignore the `Range` header and return the full resource in
a `200 - OK` response, so we need to be prepared for that.

Another important consideration; even if it does return a range, it may not be the one we asked for.
The spec states that if any part of the range is satisfiable, then that should be returned. This is
indeed the case with the Front Door service behavior we are trying to support. When it requests a
resource it asks for the first 8MB in a `Range` header. However if the resource is smaller then 8MB,
say 2KB, it will get back a `206 Partial` response with the header `Content-Range: bytes 0-2047/2048`
indicating it got all the bytes for a 2KB resource.

## Which Blob API to use

There are several different APIs that can be used when fetching a blob with the Azure SDK. The difference
between some of them, and when to use them, is outlined in the GitHub issue at <https://github.com/Azure/azure-sdk-for-net/issues/22022#issuecomment-870054035>

As it states, `DownloadContentAsync` is for smaller downloads, which is not what we are dealing with here.
`DownloadToAsync` writes to a stream or a file, but doesn't allow you to specify just a range to fetch.

`OpenReadAsync` does give you a seekable stream, which means you could potentially just pass it to the `File`
helper as the return value. However all you get here is a stream, so accessing other properties on the
blob such as the content-type etc. is not possible, thus we'd need to make another call to `GetPropertiesAsync`
to fetch that info as we did for HEAD requests, and having an extra round trip to Azure Storage on each
request is undesireable.

That leaves `DownloadStreamingAsync`, which accepts a range to fetch, and also has a return type which
exposes all the Blob properties and HTTP response details we might need.

With that, the plan is to look in the request to see if a range was requested, if so pass that range
to `DownloadStreamingAsync` to fetch only that range from Blob storage. Once we get the response, whether
a `200 OK` or a `206 Partial Content`, return the corresponding status, headers, and content stream
to the initial request.

## The return value

The `File(...)` return value helper used above is not suitable here. This expects to be given a stream
for the entire resource, and if range processing is enabled will seek within it. The stream we have
here is (potentially) partial, and also is not seekable.

I spent a while looking at the various controller return value helpers in ASP.NET Core, but ultimately
that got a little complex and may have hid subtleties, so I went back to basics. The return value
from a controller is typically an `IActionResult`, and all this needs to do is process the response
when its `ExecuteResultAsync` method is called. Implementing a `BlobStreamResult` class for this that
simply set the status and headers, and then streams the content back is simple enough.

## Cancellation

An important consideration that is often overlooked is cancellation. For each request to ASP.NET Core, there is a cancellation
token attached. It turns out requests will often be terminated early, be it for cancelling a download,
navigating elsewhere, the app crashing, or even potentially in some types of attacks. If this cancellation token is not
passed on to the calls to blob storage, then even if the client aborts the request after a couple of packets,
the service will still continue to download the full blob.

I wrote up a simple client to test this as shown below, which requests a large asset from the controller,
and then after fetching 4KB of data kills the request.

```csharp
var client = new HttpClient();
var request = await client.GetAsync("https://localhost:7098/asset/large.txt", HttpCompletionOption.ResponseHeadersRead);
var buffer = new byte[4096];
var stream = await request.Content.ReadAsStreamAsync();
var result  = await stream.ReadAsync(buffer, 0, 4096);
request.Dispose();
```

Using Wireshark to monitor traffic, and __WITHOUT__ the CancellationToken being passed to the Blob API
calls, I can see the service still goes on to fetch all 32MB from Azure Storage.

<img src="/assets/images/wireshark-no-cancellation.png"/>

After chaining through the CancellationToken from the request to the Blob API calls, I can see that
when running the same test the service connection to Azure Storage gets reset and the download aborted after about 200KB.

<img src="/assets/images/wireshark-with-cancellation.png"/>

Another important hygine consideration is to ensure the Blob stream is disposed once the response is sent.

# The Final Code

After all the above, the below is where I ended up. This seems to satisfy all the requirements for
streaming immutable blobs from Azure Storage through an ASP.NET Core controller, while supporting
Range-Requests in an efficient and correct manner. At 130 lines of code it's not too complex.

This does have a few pre-conditions to be aware of.

- This is for streaming immutable resources, hence the etags and cache-control headers being set to
  specific values, and request headers like `if-modified-since` being largely ignored. If serving mutable resources,
  then your logic will need to support that.
- This does expect that Blob Storage calls always return Content-Length and Content-Type headers, and not something
  like a chunked encoding response. The docs do state [the response has these headers](https://docs.microsoft.com/en-us/rest/api/storageservices/get-blob#response-headers),
  so I'm going to make that assumption here. (And it my testing that is the case).

```csharp
using Azure;
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;
using Azure.Storage.Blobs.Specialized;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Net.Http.Headers;
using System.IO.Pipelines;

public class BlobStreamResult : ActionResult
{
    int _statusCode;
    BlobDownloadStreamingResult _blobResult;

    public BlobStreamResult(int statusCode, BlobDownloadStreamingResult blobResult)
    {
        _statusCode = statusCode;
        _blobResult = blobResult;
    }

    override public async Task ExecuteResultAsync(ActionContext context)
    {
        try
        {
            var response = context.HttpContext.Response;
            response.StatusCode = _statusCode;
            response.Headers.ContentType = _blobResult.Details.ContentType;
            response.Headers.ContentLength = _blobResult.Details.ContentLength;

            if (_statusCode == StatusCodes.Status206PartialContent)
            {
                response.Headers.ContentRange = _blobResult.Details.ContentRange;
            }

            // Be sure to cancel flowing the stream if the request is aborted
            CancellationToken ct = context.HttpContext.RequestAborted;
            await _blobResult.Content.CopyToAsync(response.BodyWriter, ct);
        }
        finally
        {
            // Clean up the blob stream when done. A TaskCanceledException (or
            // for some other reason) may occur in the above block.
            _blobResult.Dispose();
        }
    }
}

[ApiController]
public class Controller : ControllerBase
{
    BlobContainerClient blobContainerClient;
    const string ImmutableEtag = "\"immutable\"";
    const string CacheControl  = "public, max-age=604800";

    public Controller(IConfiguration config)
    {
        string blobUri = config.GetValue<string>("BlobUri");
        blobContainerClient = new BlobContainerClient(blobUri, "assets");
    }

    [HttpHead("/asset/{assetId}")]
    public async Task<IActionResult> HeadAsset(string assetId)
    {
        try
        {
            var blobClient = blobContainerClient.GetBlockBlobClient(assetId);
            var props = await blobClient.GetPropertiesAsync();
            Response.Headers.ContentLength = props.Value.ContentLength;
            Response.Headers.ContentType = props.Value.ContentType;
            Response.Headers.AcceptRanges = "bytes";
            Response.Headers.ETag = ImmutableEtag;
            Response.Headers.CacheControl = CacheControl;
        }
        catch (RequestFailedException ex) when (ex.Status == StatusCodes.Status404NotFound)
        {
            Response.Headers.Clear();
            return NotFound();
        }

        return Ok();
    }

    [HttpGet("/asset/{assetId}")]
    public async Task<IActionResult> GetAsset(string assetId, CancellationToken ct)
    {
        Response.Headers.AcceptRanges = "bytes";
        Response.Headers.ETag = ImmutableEtag;
        Response.Headers.CacheControl = CacheControl;

        // If they have any "immutable" tagged content, then it hasn't changed
        if (Request.Headers.IfNoneMatch.Contains(ImmutableEtag))
        {
            return StatusCode(StatusCodes.Status304NotModified);
        }
        // Note: An "if-range" header may also be present which means if the representation is unchanged,
        // send me the part(s) that I am requesting in Range; otherwise, send me the entire representation.
        // Being that we only serve immutable content, the representation will be unchanged, so ignore this.

        HttpRange blobRange = default; // A default value results in requesting the full resource

        // We support a range request if it specifies exactly one range with a from position specified
        var ranges = Request.GetTypedHeaders().Range?.Ranges;
        if (ranges != null && ranges.Count == 1 && ranges.First().From.HasValue)
        {
            RangeItemHeaderValue range = ranges.First();
            long? length = range.To.HasValue ? range.To.Value - range.From!.Value + 1 : null;
            blobRange = new(range.From!.Value, length);
        }

        var blobClient = blobContainerClient.GetBlockBlobClient(assetId);
        try
        {
            var blob = await blobClient.DownloadStreamingAsync(range: blobRange, cancellationToken: ct);
            int statusCode = blob.GetRawResponse().Status;                
            return new BlobStreamResult(statusCode, blob);
        }
        catch (RequestFailedException ex) when (ex.Status == StatusCodes.Status416RangeNotSatisfiable)
        {
            // When DownloadStreamAsync throws, we don't have the return value to get headers from.
            // Fetch the properties again to get the Content-Length to return in Content-Range.
            var props = await blobClient.GetPropertiesAsync(cancellationToken: ct);
            Response.Headers.ContentRange = $"bytes */{props.Value.ContentLength}";
            return StatusCode(StatusCodes.Status416RangeNotSatisfiable);
        }
        catch (RequestFailedException ex) when (ex.Status == StatusCodes.Status404NotFound)
        {
            Response.Headers.Clear();
            return NotFound();
        }
    }
}
```
