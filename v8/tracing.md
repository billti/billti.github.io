---
layout: docs
permalink: /v8/tracing
---

# Tracing

Tracing and logging

## Perfetto

Tracing in V8 (as well as Chrome and Android generally) is done via the
[perfetto][] tracing framework. In terms of goals and operation, this is similar
to many OS-specific tracing frameworks (e.g. ETW on Windows) in that is attempts
to be a practical no-op when tracing is not enabled, writes events to an isolated
memory location, uses an efficient message/event format, can flush to disk as
running for long traces, has the concept of "producers" and "consumers" and
"sessions", can filter for only certain events, can be controlled out of band, etc.

See https://www.perfetto.dev/#/architecture.md for a high-level overview.

In the V8 repo the code can be found under `v8/third_party/perfetto`.

Notes: Mojo is the Chromium IPC mechanism used between producer/service/consumer.

If `v8_use_perfetto` is defined, then `BUILD.gn` will include the additional
sources and targets (e.g. files under `v8/src/libplatform/tracing`).

In `v8::Shell::Main` in d8.cc, `perfetto::Tracing::Initialize` is called. (If
`V8_USE_PERFETTO` is defined).


It provides a tracing service that can collect and consolidate events from user
space processes as well as the Linux Kernel (via [ftrace][]).

Describe the code under the ./src/tracing folder.
Discuss the TRACE_EVENT macro.
Discuss where system tracing, such as DTrace or ETW fit in.

Mention the dependency in DEPS on:
  'v8/base/trace_event/common':
    Var('chromium_url') + '/chromium/src/base/trace_event/common.git' + '@' + ..
This pulls in ./base/trace_event/common/trace_event_common.h, which defines
macros such as TRACE_EVENT* and TRACE_COUNTER*.

Interestingly, this uses macros such as INTERNAL_TRACE_EVENT_ADD which are not
defined in this "common" file, but in ./src/tracing/trace-event.h

## Logging

Discuss the various file output supported by the V8 switches.
Discuss the various Log* classes in V8 (e.g. JitLogger).
Traces are written as protobuf messages (see [protocol-buffers][]). The protobuf
source is under `v8/third_party/protobuf`.

[ftrace]: https://en.wikipedia.org/wiki/Ftrace
[perfetto]: https://www.perfetto.dev/
[protocol-buffers]: https://developers.google.com/protocol-buffers/
