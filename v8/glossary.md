---
layout: docs
title: Glossary
permalink: /v8/glossary
---

#### Assembly

A programming language very close to the native [Machine Code](#machine-code) of a CPU.
See <https://en.wikipedia.org/wiki/Assembly_language>.

#### Assembler

A program that takes [Assembly](#assembly) and turns it into [Machine Code](#machine-code).
Examples are the GNU assembler "as" (<https://sourceware.org/binutils/docs/as/>), and
the Microsoft assember "masm" <https://docs.microsoft.com/en-us/cpp/assembler/masm/microsoft-macro-assembler-reference>.

#### AST

An [Abstract Syntax Tree](https://en.wikipedia.org/wiki/Abstract_syntax_tree). A tree
representation of the source code created by the [parser](#parser).

#### Bailout

TODO

#### Blink
The HTML/CSS rendering engine used in Chromium based browsers. See <https://www.chromium.org/blink>.

#### Bytecode

The compact intermediate representation of the JavaScript to execute by the [Ignition](#ignition)
interpreter. An good overview can be found at <https://medium.com/dailyjs/understanding-v8s-bytecode-317d46c94775>.

#### CodeStub

A piece of code that exists as a proxy or interface into other code. Often used to convert
calling conventions, isolate callers from the location of the target code, etc.

#### CodeStubAssembler

TODO

#### D8

The V8 host in the V8 codebase that provides the ability to run code in V8 with various flags
for testing purposes.

#### Deopt

A deoptimization occurs when an assumption made in the optimized code generated by [TurboFan](#turbofan)
is incorrect. A [BailOut](#bailout) will occur and the code will continue to execute in the
[interpreter](#interpreter).

#### ExternalString

A string represenation inside V8 where the value for the string is stored outside of V8
managed memory. (The creator of the string must provide an interface to fetch the value).

#### GC

Garbage Collection is the act of reclaiming memory that is no longer being referenced.
The V8 garbage collector is called [Orinoco](#orinoco).

#### Handle

A class used in native code to hold a reference to a JavaScript object. There must be a
current [HandleScope](#handlescope) which the Handle will be created within the context of.

#### HandleScope

All [Handles](#handle) are allocated in the context of a HandleScope, and when this goes out
of scope and is destroyed (it should be stack allocated), all Handles created within
its context are assumed to be no longer referenced.

#### HeapObject

A JavaScript value which is allocated on the heap. This is any value other than a [Smi](#smi).

#### ICU

The International Components for Unicode. A database and codebase used to provide Unicode and
globalization support for software. See <http://site.icu-project.org/> for details.

#### InlineCache

An inline cache (often abbreviated to "IC") is a location in code where... TODO.

#### Ignition

The V8 interpreter used to evaluate the bytecode generated from the original source. This
executes the JavaScript code slower than the JIT compiler [TurboFan](#turbofan), but uses less
resources (e.g. memory) and is quicker to first run.

#### InternalizedString

A string automatically allocated in the "old space" of the garbage collector.

#### Interpreter

A program that executes code that is not in the native binary format for the machine.
The V8 interpreter is called [Ignition](#ignition).

#### Isolate

An instance of a V8 virutal machine within which all JavaScript execution occurs.

#### JIT

A "just in time" compiler that generates native code to run at higher speed than the
interpreter (which is [Ignition](#ignition) for V8). The V8 JIT is called [TurboFan](#turbofan).

#### Lowering

The act of taking a higher-level representation of code (e.g. [bytecode](#bytecode)) and turning it
into a lower-level representation (such as [machine code](#machine-code)).

#### Machine code
The bytes that represent the instructions native to the CPU architecture (e.g. Intel x86, ARM64, etc.)
Often representing in text format as [Assembly](#assembly).

#### MaybeLocal

A [handle](#handle) to a JavaScript value with may or may not be valid.

#### Megamorphic

TODO

#### Monomorphic

TODO

#### Oddball

[HeapObjects](#heapobject) which represent standard JavaScript values; specifically null, undefined, true,
and false.

#### Oilpan

The [Blink](#blink) [garbage collector](#gc). See design details at
<https://chromium.googlesource.com/chromium/src/+/master/third_party/blink/renderer/platform/heap/BlinkGCDesign.md>

#### OneByteString

A string containing only ASCII characters.

#### Orinoco

Orinoco is the name for the V8 [garbage collector](#gc). More details can be found at <https://v8.dev/blog/trash-talk>.

#### Parser

A component that takes tokens from the scanner, and generates a representation of the program
suitable for later phases (e.g. the [AST](#ast) and/or the [bytecode](#bytecode)).

#### Polymorphic

TODO

#### Preparser

A lighweight form of parsing that can skip work that may not be required. 
See <https://v8.dev/blog/preparser> for more details.

#### Roots

A set of predefined object types. (TODO: Confirm and clarify).

#### Scanner

A component that takes a stream of characters as input, and breaks them into the tokens
needed by the [parser](#parser), e.g. keywords, numbers, strings, identifiers, etc.
See <https://v8.dev/blog/scanner> for more details.

#### Smi

A "small integer", which can represent any integer representable in 31 bits on 32-bit platforms, or
32 bits on 64-bit platforms. The least significant bit is 0 to indicate this is not a
[Tagged Pointer](#tagged-pointer).

TODO: I assume pointer compression will make a smi only 31 bits even on 64-bit platforms?

#### Snapshot

Precompiled code for the built-in JavaScript APIs. This can be stored in a separate file, or
compiled into the V8 binary.

#### Spill

When CPU registers need to be freed up for other purposes, but the current values persisted for
future use, this is termed "spilling" the registers. (Often by placing the current values on the
stack).

#### Tagged Pointer

A tagged pointer is a value where the 2 least significant bits have meaning. If bit-0 is set, then
this is indeed a pointer and not a (Smi)[#smi]. If bit-1 is set (along with bit-0) then this is a
[Weak](#weak) pointer. Both bits 0 and 1 must be cleared before dereferencing as a pointer value.

#### Torque

A domain specific language for describing the object layouts and built-in functions in V8.

#### TurboFan

The optimizing compiler the produces the most performant native code it can.

#### TwoByteString

A string encoded internally as a series of [UTF-16](https://en.wikipedia.org/wiki/UTF-16) code units.

#### Weak

A "weak" reference or pointer means the object it refers to may be freed (if not "strongly"
referenced elsewhere), and that the validity of the object needs to be verified before accessing it.