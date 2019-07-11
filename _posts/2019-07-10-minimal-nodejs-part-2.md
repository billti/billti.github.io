---
layout: post
title: Minimal Node.js native modules - N-API
---

_This is a continuation from [part 1](/2019/02/08/minimal-nodejs.html). It is recommended to read this
post first._

In this section we are going to write a native module for Node.js using C++ and the technique outlined
in the first post. Set this up as follows:

 1. Create an empty directory to host the project and `cd` into it.
 2. Assuming you have a 64-bit Node.js >= v10.3 on your PATH, run `npm init vs-napi`.

This runs the [create-vs-napi](https://github.com/billti/create-vs-napi) npm package I created
to get up and running quickly with a Visual Studio 2017 project for experimentation writing Node.js
native modules using the N-API API. It is used here mainly to fetch the header files and import library
needed for Node.js development, but if interest, open the project in Visual Studio and
build (or just run `msbuild <projectname>` from the Developer Cmd Prompt), and then run `node test.js`
to verify the native module works. Delete the output directories (`obj` and `x64`) afterwards.

For clarity, builds will be done via the command-line compiler rather than MSBuild and/or .vcxproj files.
To make this easily repeatable, create a file named `build.bat` as shown below. Note that some options
have been added over the prior post, mostly for generating debug info and specifying directory paths.

```bat
@ECHO OFF
SETLOCAL
if not "%VSCMD_ARG_TGT_ARCH%"=="x64" (
    echo Please build from an x64 Native Tools command prompt for VS 2017
    exit /b 1
)

:: Compiler options are:
:: - /O2  optimize for speed
:: - /GS- switch off extra runtime security checks (these need the CRT)
:: - /LD  build a DLL
:: - /Zi  generate debug info
:: - /I   add a include directory
:: - /D   preprocess defines
:: - /F?  specify output locations for .obj, .pdb, and final binary
SET CL=/O2 /GS- /LD /Zi /I"include\node" /D"UNICODE" /Fdx64\ /Fox64\ /Fe"x64\vsnapi.node"

:: Linker options are:
:: - /OPT           enable given optimizations (using the /Zi setting defaults them to off)
:: - /NODEFAULTLIB  do not link to the C runtime by default
:: - /ENTRY         use the given entry point (not the default CRT one)
SET LINK=/OPT:REF,ICF /NODEFAULTLIB /ENTRY:DllMain

:: This will use the CL and LINK environment variables for options
cl main.cc kernel32.lib lib\node\x64\node.lib
```

Now from an `x64 Native Tools Command Prompt` in the directory, run `build` - and the build will fail.

This is because the sample code doesn't provide a DllMain entry point and depends on the C runtime.
You can temporarily remove the `/NODEFAULTLIB` and `/ENTRY` options and the code will compile by linking
statically to the CRT, then run `node test.js` and see that the module does work (and is around 90KB
on my machine). Now add the linker options back to exclude the CRT, and we'll fix CRT dependency.

## Initialization

When using the C runtime library, various things are taken care of automatically under the covers. Chief
amongst these is initialization. When building a Node.js native module certain macros expand to be
globals that are initialized at startup. If not using the CRT, this will need to be done _"manually"_.

One of the key lines in the C++ code for the Node.js module is the line:

```cpp
NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
```

This expands in the preprocessor to the below (if NODE_GYP_MODULE_NAME was defined as `vsnapi`):

```cpp
extern "C" {
    static napi_module _module =
    {
        1,
        0,
        __FILE__,
        init,
        "vsnapi",
        0,
        {0},
    };
    static void __cdecl _register_vsnapi(void);
    __declspec(dllexport, allocate(".CRT$XCU")) void(__cdecl * _register_vsnapi_)(void) = _register_vsnapi;
    static void __cdecl _register_vsnapi(void) {
        napi_module_register(&_module);
    }
}
```

This depends on some C runtime "magic" to call `napi_module_register` at load time with the `_module`
structure, by putting a pointer to a function to run (`_register_vsnapi`) directly into a section
(`.CRT$XCU`) the CRT reads when it runs at startup. (i.e. the entry point we no longer have).

_Note: I highly recommend the Matt Godbolt talk [The bits between the bits][] for an under the covers
look at how this initialization works at startup when using the C runtime. The documentation on
[CRT Initialization][] also gives a good overview._

To do the same initialization at load time without the CRT, we'll provide the DllMain entry function
and run similar code directly when the module is loaded. After also adding the `windows.h` include to
the top of the file, the entire `main.cc` file should appear as shown below.

```cpp
#include <windows.h>
#include <node_api.h>

namespace vsnapi {

napi_value Method(napi_env env, napi_callback_info args) {
  napi_value greeting;
  napi_status status;

  status = napi_create_string_utf8(env, "hello", NAPI_AUTO_LENGTH, &greeting);
  if (status != napi_ok) return nullptr;
  return greeting;
}

napi_value init(napi_env env, napi_value exports) {
  napi_status status;
  napi_value fn;

  status = napi_create_function(env, nullptr, 0, Method, nullptr, &fn);
  if (status != napi_ok) return nullptr;

  status = napi_set_named_property(env, exports, "hello", fn);
  if (status != napi_ok) return nullptr;
  return exports;
}

//NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
extern "C" {
  static napi_module _module;

  bool WINAPI DllMain(HINSTANCE hinstDLL, DWORD fdwReason, LPVOID lpvReserved) {

    if (fdwReason == DLL_PROCESS_ATTACH) {
      _module = {
        NAPI_MODULE_VERSION,
        0,
        __FILE__,
        init,
        "vsnapi",
        0,
        {0},
      };

      napi_module_register(&_module);
      return true;
    }
  }
}

}  // namespace vsnapi
```

Now when you run `build`, it should compile without error, and run as before when `node test.js` is
run. The resulting binary is not using the CRT, and on my machine the binary size is around 3KB:

```text
  3,072 vsnapi.node
```

## Delay loading

There is a problem with the above module. The `node.lib` library it links to tells the program it will
find the N-API functions it needs in the `node.exe` module. This can be seen by running `dumpbin /dependents /imports x64\vsnapi.node`
which will contain a section of output similar to:

```text
  Section contains the following imports:

    node.exe
             18000C218 Import Address Table
             180014498 Import Name Table
                     0 time date stamp
                     0 Index of first forwarder reference

                        38B5 napi_create_function
                        38BE napi_create_string_utf8
                        390B napi_set_named_property
                        38FB napi_module_register
...
```

However in certain environments this is not the module exporting those functions. For example, in an
Electron application, they are contained in a `node.dll` binary beside the `electron.exe` executable.

If you created the project skeleton as initially outlined, you will have noticed a `win_delay_load_hook.cc`
file was also created. This is responsible for intercepting any calls to locate the `node.exe` module,
and return the "correct" module as appropriate.

_Note: If interested, you can see some discussion of this code on [this pull request](https://github.com/nodejs/node-gyp/pull/653),
and a quick summary of the problem/solution on [this stack overflow post](https://stackoverflow.com/questions/280485/how-do-i-rename-a-dll-but-still-allow-the-exe-to-find-it)_

Setting the option to delay load and hook the loading of the `node.exe` module requires linking to
`delayimp.lib` however, and unfortunately that depends on the CRT. So that option is out. An alternate
approach is possible that requires a little bit of code, but has some additional nice properties.

### Explicit loading

A solution to the above problem is to explicitly load the N-API module and functions using the Win32 APIs
[GetModuleHandle()](https://docs.microsoft.com/en-us/windows/desktop/api/libloaderapi/nf-libloaderapi-getmodulehandlew)
and [GetProcAddress()](https://docs.microsoft.com/en-us/windows/desktop/api/libloaderapi/nf-libloaderapi-getprocaddress).
GetModuleHandle requires that the module is already loaded, but Node must be loaded as it is loading the
extension. GetProcAddress has the benefit of feature detection via late binding to N-API functions,
rather than failing to load the module is an import is not present.

Another benefit is that the `node.lib` library does not need to be linked in any more. In fact, with
this approach N-API Node.js modules can be built with only two header files (currently) from Node.js:
`node_api.h` and `node_api_types.h`.

This does mean each N-API function is called through an indirect pointer however. The below code shows
how this could be done with a helper macro.

```cpp
// TODO: Find a cleaner way than this
bool LoadNapiFunctions()
{
  // Handle to the .exe for the current process (e.g. node.exe in the mainline scenario)
  HMODULE nodeModule = GetModuleHandle(NULL);
  // See if this contains the APIs we want to use.
  FARPROC fn_addr = GetProcAddress(nodeModule, "napi_module_register");

  // If not, see if node.dll is present and contains the exports (e.g. Electron scenario).
  if (fn_addr == NULL) {
    nodeModule = GetModuleHandle(L"node.dll");
    if (nodeModule == NULL) return false;
    fn_addr = GetProcAddress(nodeModule, "napi_module_register");
    if (fn_addr == NULL) {
      // Couldn't find the module with the N-API exports
      return false;
    }
  }

  bool apiLoadFailed = false;

  // Macro to simplify retrieving of delay loaded N-API functions. Keep format in sync with DECL_NAPI_IMPL in napi.h
#define GET_NAPI_IMPL(fn_name)                      \
    fn_addr = GetProcAddress(nodeModule, #fn_name); \
    if (fn_addr == NULL) apiLoadFailed = true;      \
    p##fn_name = (decltype(p##fn_name))fn_addr;

  // Assign the addresses of the needed functions to the "p*" named pointers.
  GET_NAPI_IMPL(napi_module_register);
  GET_NAPI_IMPL(napi_create_function);
  GET_NAPI_IMPL(napi_set_named_property);
  GET_NAPI_IMPL(napi_create_string_utf8);

  // If any required APIs failed to load, return false
  if (apiLoadFailed) return false;

  // Fetch the optional APIs if present.
  GET_NAPI_IMPL(napi_add_env_cleanup_hook); // Not available on Node.js 8

  return true;
}
```

The declarations and definitions for the N-API function points are in a header file as below:

```cpp
#include <node_api.h>

// NAPI_IMPL is defined before including this header in the one .cc file that defines the pointers
#ifdef NAPI_IMPL
  #define DECL_NAPI_IMPL(fn_name) decltype(&fn_name) p##fn_name
#else
  #define DECL_NAPI_IMPL(fn_name) extern decltype(&fn_name) p##fn_name
#endif

DECL_NAPI_IMPL(napi_module_register);
DECL_NAPI_IMPL(napi_create_function);
DECL_NAPI_IMPL(napi_set_named_property);
DECL_NAPI_IMPL(napi_create_string_utf8);
DECL_NAPI_IMPL(napi_add_env_cleanup_hook); // Not available on Node.js 8
```

The `LoadNapiFunctions` function is called at initialization in `DllMain`, and the N-API APIs are called
through the `p`-prefixed function pointers (checking for NULL first for optional APIs), e.g.

```cpp
void DoSomething() {
  // If the DLL loaded OK, this required function was present
  pnapi_create_function(/* ... */);

  // The below was optional and isn't present pre Node.js 8
  if (pnapi_add_env_cleanup_hook != NULL) {
    pnapi_add_env_cleanup_hook(/* ... */);
  }
}
```

## A final wrinkle

While we've done our best to avoid dependencies on the CRT library in our code, the compiler itself can
actually generate calls to CRT functions in the code it generates. There are two things you can do if
and when this occurs:

- Enable [intrinsics][] in the compiler (on by default in `/O2` builds). This means the compiler MAY
  replace some function calls (e.g. `memcpy`) with inline versions, avoiding the need to link to an implementation.
- Provide your own version of the function the linker fails to find. Most simple CRT functions (e.g.
  `malloc`, `memcpy`, etc.) are relatively short and trivial to find examples of. (For example, see
  some of the provided functions/operators at <https://github.com/billti/tsetwlog/blob/master/src/crt.cpp>).

## Conclusion

While not entirely trivial and obvious, it is possible to write a N-API module which does not depend
on the C-runtime library. This can avoid some pitfalls with both dynamic linking (are the required DLLs
present), and static linking (binary size and resource allocation).

This does mean common C-runtime functionality must be avoided or re-implemented, but if the module
is simple enough (and platform specific) this can result in a small binary with minimal dependencies.

Thanks for reading!

[The bits between the bits]: https://www.youtube.com/watch?v=dOfucXtyEsU
[NAPI API]: https://nodejs.org/dist/latest-v10.x/docs/api/n-api.html
[CRT Initialization]: https://docs.microsoft.com/en-us/cpp/c-runtime-library/crt-initialization?view=vs-2017
[intrinsics]: https://docs.microsoft.com/en-us/cpp/intrinsics/compiler-intrinsics
