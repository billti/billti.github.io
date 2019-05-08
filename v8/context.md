---
layout: docs
title: Context
permalink: /v8/context
---

# Context

A context represents the top level global state in executing JavaScript. For
example, the global objects Math, Array, Promise, etc. as well as any top level
variables. A new context is typically created within an isolate when a web page
creates a new iFrame with the same origin domain. (TODO: Confirm and note that
an iFrame in a different domain gets a new isolate).
