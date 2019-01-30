---
layout: docs
title: V8 platform
permalink: /v8/platform
---

# Platform

To create an Isolate, a Platform must be provided. A Platform provides general environment
services and configuration such as the thread pool, a task runner, a memory allocator, etc. This is
apparent from looking at the members of a Platform in the debugger, for example:

<img src="/assets/images/default-platform.png"/>
