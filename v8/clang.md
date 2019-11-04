---
layout: docs
title: Clang
permalink: /v8/clang
---

## Clang
Clang is the C++ compiler that is part of the LLVM project (see https://llvm.org/)

The compiler (`clang-cl.exe`) and linker (`lld-link`) are installed to `./third_party/llvm-build/Release+Asserts/bin/`
by a gclient hook (invoked when running `gclient sync`) running the script in `./tools/clang/scripts/update.py`

When you kick off a build via something like `ninja -C out/x64.debug` then a large
number of `clang-cl.exe` processes will get kicked off to do the build.
