---
layout: docs
permalink: /v8/setup
---

# Machine setup
On Windows, you will need to install little beyond Visual Studio (with the
necessary C++ components), and the `depot_tools` package from Google. Follow
the instructions documented at https://v8.dev/docs/source-code .

A couple of notes to make working on Windows easier:

 - Ensure that depot_tools is on your path before any other Python or Git
   location. There are specific Python packages and Git commands in the binaries
   in those locations that need to be used.
 - Some of the docs will show just running the Python script directly (e.g. 
   `./tools/dev/gm.py`). This will not work by default on Windows, and the
   command-line should be prefixed with the `python` executable.
 - I recommend installing [VS Code][] for editing, and [WinDbg][] for debugging.

 [VS Code]: https://code.visualstudio.com/
 [WinDbg]: https://docs.microsoft.com/en-us/windows-hardware/drivers/debugger/
