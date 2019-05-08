---
layout: docs
title: V8
permalink: /v8
---

# V8 overview

V8 is a JavaScript engine created by Google, and opened sourced on September 2nd, 2008. (The same
day Chrome was launched). Today it is used in many projects beyond Chromium, most notably as the
engine powering Node.js. The official site for V8 is at [https://v8.dev/](https://v8.dev/).

This book will attempt to lay out the information needed to work effectively with V8. Whether that
be to contribute back to the V8 project, to embed the V8 engine into your own project, to
troubleshoot issues you encounter, or simply to learn more about a bleeding-edge JavaScript engine.

#### Prerequisites

The information presented here expects you are already quite familiar with C++ and JavaScript. It
does not attempt to explain any of the semantics of those languages, unless they are particularly
relevant to a topic being covered. A basic familiarity with X64 assembly will be helpful.

#### Environment

V8 runs on numerous operating systems and CPU architectures. Most of the V8 codebase is written
to be as OS and CPU agnostic as possible. Likewise, much of the tooling around V8 works across
platforms (e.g. the Clang compiler, Python, etc). This book will try to keep the content as agnostic
as possible also. That said, my main environment is Windows 10 running on an x64 platform, and where
necessary, platform specific information will reflect this. (Such as the [Machine Setup] section).

[Machine Setup]: /v8/setup
