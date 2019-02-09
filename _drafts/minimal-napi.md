---
layout: post
title: Minimal Node.js native modules - NAPI
---

{% comment %}
# TODO

  - [ ] Reproducing the NAPI CRT initialization functionality in DllMain.
  - [ ] Using the OS APIs for string manipulation.
  - [ ] Providing simple substitutes for needed CRT functions (e.g. malloc/free, new/delete, strlen, etc.)
  - [ ] Challenges with the loader hooks and delayimp.lib (needed for Electron).
  - [ ] Dynamically loading the Node.js module and NAPI functions.
  - [ ] The added benefit of feature detection!
  - [ ] A header only dependency for Node.js!
{% endcomment %}

_This is a continuation from [part 1](/2019/02/08/minimal-nodejs.html). It is recommended to read this
post first._

