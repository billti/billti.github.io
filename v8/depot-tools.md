---
layout: docs
title: Depot Tools
permalink: /v8/depot-tools
---

## Depot Tools

Depot Tools is a suite of utilities for maintaining the builds and enlistments
on your development machine. See the [Depot Tools Tutorial](https://commondatastorage.googleapis.com/chrome-infra-docs/flat/depot_tools/docs/html/depot_tools_tutorial.html) for more details.

Depot Tools should be on your path, which will then give you command-line tools
such as gclient, fetch, clang-format, gn, autoninja, python, git, etc.

Review the [Setting up Windows](https://chromium.googlesource.com/chromium/src/+/master/docs/windows_build_instructions.md#setting-up-windows)
notes. As of this time of writing, the below should be done:

 - Set `DEPOT_TOOLS_WIN_TOOLCHAIN` to 0 (if not working for Google).
 - Ensure the `depot_tools` folder (containing `python.bat`) is on your path
   before any other Python.
 - Ensure Visual Studio 2017 or later is installed along with the C++ Tools and
   a recent Windows SDK.
 - Set the Visual Studio version in the environment variable `GYP_MSVS_VERSION`
   (e.g. `set GYP_MSVS_VERSION=2019`).
 - If running a build still has trouble locating Visual Studio, you may also set an
   environment variable like the following to help locate it.
   `set GYP_MSVS_OVERRIDE_PATH=C:\Program Files (x86)\Microsoft Visual Studio\Preview\Enterprise`
