---
layout: post
title: Minimal Node.js native modules
---

I recently wanted to author a Node.js native module for inclusion into an application that only runs
on Windows. I wanted to keep the size and dependencies as small as possible. I hit numerous pain-points.
This is my journey.

_Note: This first post will deal only with consideration in using the C runtime library. A follow-up post will
discuss how to build a Node.js native module with the build options laid out below._

## The C runtime library.

Dealing with the C runtime library can be complicated on Windows. The standard cross-platform APIs you
can write with is highly valuable, but on Windows you have two ways to use the CRT, and both have pros and cons.

_Note: Many of the issues I hit regarding the CRT for Node.js binaries I subsequently found were also hit by Steve Dower
with Python binaries for many of the same reasons. I highly recommend reading [his blog posts](https://stevedower.id.au/blog/building-for-python-3-5-part-two/) on the topic for greater detail on the underlying issues._

### Dynamically linking

This is the recommended approach, with minimal issues **if** the CRT DLLs are already present on the machine.
If you are distributing a large package for install, then you can bundle the CRT redistributable into your
installer to make sure. However, when you are trying to distribute a small package via npm - that should
install with minimal install scripts, permissions, and package size - this isn't a good option.

Recently an updated CRT has begun to be included on Windows systems. (See [this blog post](https://blogs.msdn.microsoft.com/vcblog/2015/03/03/introducing-the-universal-crt/)
on the Universal C runtime). However this is not a solution as:

  1. This only includes the C-runtime, not the vcruntime or C++ bits, so those will likely still need to be distributed
  2. This updated system-level CRT still may not be present on a large number of Windows machines. (It is either applied as an update or [a download](https://support.microsoft.com/en-us/help/2999226/update-for-universal-c-runtime-in-windows) for certain Windows versions).

This makes dynamically linking in the CRT a poor option for apps/packages that ship as a small
standalone binary without a full Windows installer currently.

### Static linking

Another option is to compile the needed CRT functionality directly into your binary. This eliminates all
runtime dependencies on separate CRT binaries, but still has issues to contend with:

  1. Certain patterns are then to be avoided, specifically those that may share state across binaries that use
     the C runtime library. Basically, certain functionality in the CRT depends on global/share state within
     the process, but if multiple binaries statically link the CRT, then each has its own copy of this state.
     ([This link](https://docs.microsoft.com/en-us/cpp/c-runtime-library/crt-library-features?view=vs-2017#what-problems-exist-if-an-application-uses-more-than-one-crt-version) contains some details).
  2. Loosely related to the above, each initialization of the CRT (which now happens in each statically linked
     copy), consumes some finite resource - the most problematic of these being fiber-local storage. If you
     load enough binaries that statically link the CRT, you could potentially exhaust the limit, causing failures.
     Steve's blog linked to above contains much greater detail on this.
  3. Size. While in a _real_ app, even a few MB might be trivial, I was aiming for a minimal package size. My module
     is very lightweight, and with dynamical linking to the CRT the binary was less than 20KB. But with static linking,
     even with minimal CRT usage, this ballooned to close to 100KB. (Which may still not be much compared to many
     npm packages commonly installed today, but still seemed excessive to me).

_Note that building native Node.js modules using `node-gyp` today uses this static linking approach._

### No linking

There is another option: Don't use the C/C++ runtime libraries. For the limited functionality my module required,
and as I was only targeting Windows, this was a perfectly valid option. However it did come with some
interesting challenges we'll cover along the way. (Most notably: Initialization and delay-loading).

## Building with the various CRT options

But first, let's see how these options differ in compiler flags and resulting binary size. We'll use
a basic console application for simplicity.

To follow along, open a `x64 Native Tools Command Prompt`, (assuming you have Visual Studio 2017
or the C++ Build Tools installed), and create a file named `myapp.cpp`. Enter the below code, which
is about the simplest "Hello, world" C++ program you can write.

```cpp
#include <iostream>

int main() {
    std::cout << "Hello, world" << std::endl;
}
```

Compile this at the command line with `cl /O1 /MT /EHsc myapp.cpp `. The flags given here are:

 - `/O1` fully optimize with a preference for minimal size
 - `/MT` statically link in the C runtime library
 - `/EHsc` enable C++ exceptions (makes little difference here, but avoids a build warning)

The output size this gives me is:

```
  224,768 myapp.exe
```

Nearly 225kb for "Hello, world"! For reference, compile again linking the CRT dynamically
(changing the `/MT` option for `/MD`). On my machine, this results in:

```
  11,264 myapp.exe
```

So of that ~225KB, all but ~11KB is C/C++ runtime code that can be dynamically link in. To see the
DLLs that the binary depends on and what it imports from them run the command:

```
dumpbin /dependents /imports myapp.exe
```

This will show the few DLLs this application will load at runtime, and the functions it will use from
them. (Which is quite a few for such a simple application).

But as outlined above, this isn't really an option for an npm distributed Node.js native module,
so back to static linking with the `/MT` option for now.

Next to try getting rid of the C++ code and stick to plain old C. Change the code to the below:

```cpp
#include <stdio.h>

int main() {
    puts("Hello, world");
}
```

Compile this with `cl /O1 /MT myapp.cpp` (note that exception support is not needed now). This now gives
me a binary size of:

```
  97,280 myapp.exe
```

That's a pretty significant saving, going from nearly 225kb to under 100kb by switch to plain C.

And finally, not using the C runtime at all, and just using the APIs provided by Windows. You give
up numerous things here (not least portability and the ability to use C++ exceptions), but let's
give it a shot. Change `myapp.cpp` to:

```cpp
#include <windows.h>

int main() {
    char msg[] = "Hello, world\n";
    DWORD written = 0;
    WriteFile(
        GetStdHandle(STD_OUTPUT_HANDLE),
        (void*)msg, sizeof(msg) - 1, &written, NULL
    );
}
```

The command line to compile now becomes a bit more complicated, namely:

```
cl /O1 /GS- myapp.cpp kernel32.lib /link /NODEFAULTLIB /ENTRY:main
```

Note that `/MT` is no longer needed, as we are not linking the CRT in at all. The additional options are:

 - `/NODEFAULTLIB` tells the linker it to ignore ALL the default libraries (e.g. the CRT)
 - `/ENTRY:main` tell the linker to run `main` on launch (rather than the usual CRT entry point)
 - `kernel32.lib` says we want to link to the kernel32.dll Windows system binary
 - `/GS-` disables additional runtime security checks (as some depend on the CRT)

With that, compiling on machine now results in a binary of:

```
  2,560 myapp.exe
```

A fully function x64 Windows binary at 2.5KB in size! You can run it and see `"Hello, world"` written
to the console. At the developer command prompt you can run `dumpbin /dependents /imports myapp.exe`
again and see that it is dependent only only one other DLL at runtime (kernel32.dll) and imports just
two functions from it. Nice!

In the next post we'll discuss how to build a Node.js native module (for Windows) without using the
C runtime library via the approach outlined above.

<!--
# TODO

  - [ ] Reproducing the NAPI CRT initialization functionality in DllMain.
  - [ ] Using the OS APIs for string manipulation.
  - [ ] Providing simple substitutes for needed CRT functions (e.g. malloc/free, new/delete, strlen, etc.)
  - [ ] Challenges with the loader hooks and delayimp.lib (needed for Electron).
  - [ ] Dynamically loading the Node.js module and NAPI functions.
  - [ ] The added benefit of feature detection!
  - [ ] A header only dependency for Node.js!
-->
