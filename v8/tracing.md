---
layout: docs
permalink: /v8/tracing
---

# Tracing

Tracing and logging

### Tracing
Describe the Perfetto tracing framework.
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


### Logging
Discuss the various file output supported by the V8 switches.
Discuss the various Log* classes in V8 (e.g. JitLogger).
