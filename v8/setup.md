---
layout: docs
permalink: /v8/setup
---

## Machine setup

_The V8 docs at [https://v8.dev/docs/source-code](C:\src\v8\v8\tools\dev) are the
authorative reference. Please check there for the latest guidance_

Below are the quick steps to get a working V8 development environment, if your
machine is running a 64-bit version of Windows 10.

1. Install [Visual Studio] (2017 or 2019), ensuring at least the "Desktop Development with C++"
workload is installed, and that the "Windows SDK" component (version 10.0.17763
or higher) is also installed.
2. Download and extract the Google "depot_tools" bundle to a local path from
[https://storage.googleapis.com/chrome-infra/depot_tools.zip](https://storage.googleapis.com/chrome-infra/depot_tools.zip).
For these examples the files have been extracted to `C:\src\depot_tools`. Extract by right-clicking
on the downloaded package and selecting "Extract..." to ensure all files are extracted.
(Which may not happen if "drag and drop" from the .zip file is performed).
3. Edit the system variables to add the depot tools path to the PATH variable.
4. Edit the system variables to add a variable named 'DEPOT_TOOLS_WIN_TOOLCHAIN'
with a value of `0`. (This is needed if not an internal Google user).
5. Open a Command Prompt and run `gclient` to perform the initial sync of binaries.
6. From the command prompt run `where python` and ensure that the "depot tools"
version is the first found. (Other Python versions will fail for some scripts).
7. Create a directory for V8, (e.g. `C:\src\v8`), and CD into that directory.
8. Run `fetch v8` to clone the V8 source code into the directory (i.e. you will end
up with the V8 source at `C:\src\v8\v8`).
9. To regularly update the V8 source and the gclient tools, run `git pull` followed
by `gclient sync` while in the `C:\src\v8\v8` directory.

### Configuring Git
Configure git with your user name and email address. To configure this globally
on the machine run the below with the appropriate values:

```
git config --global user.name "Your name"
git config --global user.email "alias@domain.com"
```

### Making Python scripts easy
Many of the V8 docs show running Python scripts by simply issuing the script
name at the command prompt, e.g. `tools\dev\gm.py`. This does not work by default
on Windows, and the command should be prefixed with the executable, e.g.
`python tools\dev\gm.py`. This can be simplified on Windows with the following:

#### Ensure .py files are designated as Python files
Do this by running `assoc .py=Python.File`

#### Associate Python files with the depot_tools Python
`ftype Python.File="C:\src\depot_tools\python.bat" "%1" %*`

_(Note: Due to a Windows bug, you may need to go into "Settings / Choose Default
Apps by File Types" and locate the ".py" extension and choose the "Python.bat"
script here also)_

You can also avoid the need to type the Python extension by editing the PATHEXT
environment variable and adding `;.py` to the end. If you also add the Python
dev scripts location to the PATH (e.g. `C:\src\v8\v8\tools\dev`), then you can
run scripts by just typing their name, e.g. `gm --help` rather than
`python tools\dev\gm.py --help`.

[Visual Studio]: https://visualstudio.microsoft.com/
