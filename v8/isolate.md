---
layout: docs
title: Isolate
permalink: /v8/isolate
---

# Isolate

An isolate represents an instance of the V8 virtual machine. JavaScript code
running in one isolate does not affect the state of any other isolates, and
isolates may be running concurrently, i.e. different threads in a process may
be simultaneously executing in different isolates. As only one thread may be
running in an isolate at any time (specifically, has entered the isolate but
not yet exited), this is the only way to get true concurrency in V8 currently.

