#!/bin/sh
# Rebuilds voice.wasm, the built-in voice for Voice cues (motus_voice.c), from Flite's sources with the WASI SDK.
# Only US English and the "slt" voice are built in, to keep the file small (about 3 MB, 2.5 MB compressed).
# Needs curl, make and about 600 MB in a temporary folder. Run: sh apps/web/src/workout/voice/build.sh
set -eu
# Flite's own build gives the WASI build its settings (config/system.mak), the Motus file below needs the same
HERE=$(cd "$(dirname "$0")" && pwd)
WASI_SDK=34
FLITE=6c9f20dc915b17f5619340069889db0aa007fcdc # festvox/flite master, 2022-05: version 2.3 with the WASI fixes
T=$(mktemp -d)
cd "$T"
curl -sL "https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-$WASI_SDK/wasi-sdk-$WASI_SDK.0-x86_64-linux.tar.gz" | tar xz
W="$T/wasi-sdk-$WASI_SDK.0-x86_64-linux"
curl -sL "https://github.com/festvox/flite/archive/$FLITE.tar.gz" | tar xz
cd "flite-$FLITE"
printf 'LEXES += cmulex\nLANGS += usenglish\nVOXES += cmu_us_slt\n' > config/motus.lv
FLAGS="-Os -D_WASI_EMULATED_SIGNAL -D_WASI_EMULATED_PROCESS_CLOCKS"
./configure --host=wasm32-wasi --with-langvox=motus --with-audio=none CC="$W/bin/clang" AR="$W/bin/llvm-ar" \
  RANLIB="$W/bin/llvm-ranlib" CFLAGS="$FLAGS" LDFLAGS="-lwasi-emulated-signal -lwasi-emulated-process-clocks" >/dev/null
# the libraries only: Flite's own command line program isn't needed (and its parallel build trips over itself)
make -C include >/dev/null; make -C src >/dev/null; make -C lang >/dev/null
L=build/wasm32-wasi/lib
"$W/bin/clang" $FLAGS -DWASM32_WASI -DCST_NO_SOCKETS -DDIE_ON_ERROR -mexec-model=reactor -Iinclude -Ilang/cmu_us_slt "$HERE/motus_voice.c" -o voice.wasm \
  -L$L -lflite_cmu_us_slt -lflite_usenglish -lflite_cmulex -lflite -lwasi-emulated-signal -lwasi-emulated-process-clocks -lm
"$W/bin/llvm-strip" voice.wasm
cp voice.wasm "$HERE/voice.wasm"
cp COPYING "$HERE/FLITE-LICENSE.txt"
rm -rf "$T"
