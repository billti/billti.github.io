---
layout: docs
title: V8 concepts
permalink: /v8/concepts
---

## Overview of V8 concepts

This section will provide a very high level overview of the major V8 components to provide
some context before delving deeper.

### Platform

V8 does not provide a host environment (other than the D8 utility used for testing).
V8 requires certain services that a host may wish to provide, such as a thread-pool,
a task-runner, a memory allocator, logging infrastructure, etc. These are provided by
implementing a `Platform`, or which V8 provides a `DefaultPlatform` for basic usage.

### Isolate

An `Isolate` is effectively an instance of the V8 JavaScript virtual machine within a
process. Some immutable read-only state may be shared by isolates (such as the executable
code for built-in functions), but otherwise any state for the V8 virtual machine is
contained within an isolate. Only one thread may be running within an isolate at any
given time. (Though multiple isolates may be executing concurrently).

### Context

A `Context` provides the environment that any running JavaScript sees, such as the global
JavaScript objects. A context is useful for things like iframes, where each iframe has
its own global objects. As only one thread can be running in an isolate, a context
does not provide any concurrency (if multiple contexts are in the same isolate).

### Handles and Scopes

References to V8 allocated objects are maintained with "Handles" in native code (often
represented via the "Local" or "MaybeLocal" class). A handle is a form of indirection
that allows for the garbage collector to efficiently track resource usage.

Handles are allocated within the context of a "HandleScope". These are stack allocated
objects, and when they go out of scope and are destroyed, the handles within them are
also assumed to be no longer referenced (i.e. the garbage collector can reclaim them).

There are also "Persistent" and "Global" handles for the case where an object needs to
be referenced in native code beyond the lifetime of a "HandleScope".

TODO: Confirm and clarify the information here.

### Parser

The V8 parser is used to take a source file (represented as one big string by the time
V8 gets it), and turn this into a representation that V8 can understand. As with many
production parsers today, the V8 parser is a hand-written [recursive decent](https://en.wikipedia.org/wiki/Recursive_descent_parser)
parser. The V8 parser does not produce as AST (TODO: confirm), but generates bytecode
for the interpreter directly.

### Interpreter

The V8 interpreter, named ["Ignition"](https://v8.dev/docs/ignition), takes the bytecode
generated by the parser, and executes it to provide a full JavaScript engine implementation.
As the bytecode executes, execution characteristics are tracked, such as what types are observed
in expressions, and which code is executed frequently, to provide input to the compiler.

### Compiler

The "Just-in-time Compiler" (sometimes just called the "JIT"), named 
["TurboFan"](https://v8.dev/docs/turbofan), takes
the bytecode and data from runtime monitoring, and produces optimized native code for
the CPU. This provides much faster execution than the interpreter, unless a "bailout"
is detected (where the choices the JIT made turn out to be wrong) and the execution
reverts back to the interpreter (and may again later be chosen for compilation).

### Garbage Collector

V8 is a "garbage collected" JavaScript engine. As allocated memory becomes unused,
it is left allocated until the garbage collector scans memory to see which memory
can be freed. The V8 garbage collection can run some phases concurrently on separate
threads. It is also a "compacting" garbage collector, which means objects may be
moved as the garbage collector runs.

### Debugger

V8 includes a debugger, that external tools may talk to via a debug protocol know
as the [inspector protocol](https://v8.dev/docs/inspector). The debugger supports
standard operations such as break, step, evaluate expressions (including variables),
set breakpoints, etc. The inspector protocol "domains" of [Debugger](https://chromedevtools.github.io/devtools-protocol/tot/Debugger)
and [Runtime](https://chromedevtools.github.io/devtools-protocol/tot/Runtime) provide
most of the functionality in this area.

### Profiler

A CPU profiler is included in V8, which may also be communicated with via the
inspector protocol's [Profiler](https://chromedevtools.github.io/devtools-protocol/tot/Profiler)
domain. This works by interrupting the main JavaScript thread 1000 times per second and walking
the stack. (TODO: Doesn't this work differently on different OSes?).

A heap profiler is also included in V8, again accessible via the
inspector protocol's [HeapProfiler](https://chromedevtools.github.io/devtools-protocol/tot/HeapProfiler)
domain. This can be used to collect heap snapshots to view the allocated objects, what is
retaining them, and see a difference between two snapshots. (Among other features).

### Snapshot

At build time, the built-in functions for the standard JavaScript APIs are precompiled
into a binary form known as a "snapshot". This may be packages into the main V8 binary
or as a standalone binary file. This provides an optimization at startup time, as
the functions to not need to be compiled again.

### ICU

V8 [internationalization](https://v8.dev/docs/i18n) is provided by the
[International Components for Unicode](http://userguide.icu-project.org/intro), often
appreviated to simply "ICU". This consists of a database of information for timezones,
countries, locales, etc. (for example in "v8\third_party\icu\common\icudtl.dat"), as
well as the source code to work with it (e.g. under "v8\third_party\icu\source").

### Torque

[Torque](https://v8.dev/docs/torque) is a domain specific language used to describe
the layout of built-in types, as well as the code for built-in methods. This provides
for more control and optimizations over writing in JavaScript, while also providing
a higher-level abstraction and more productive development experience.

### Code stub assembler

TODO [CSA](https://v8.dev/docs/csa-builtins)

### Wasm

TODO

### D8

TODO [D8](https://v8.dev/docs/d8)

### Tracing

TODO [Tracing](https://v8.dev/docs/trace)