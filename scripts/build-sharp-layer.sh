#!/usr/bin/env bash
set -euo pipefail

WORK=/tmp/sharp-build
rm -rf "$WORK" && mkdir -p "$WORK"
docker run --rm -v "$WORK":/work -w /work public.ecr.aws/lambda/nodejs:20 bash -c '

  yum -y install gcc gcc-c++ make automake autoconf libtool \
                 nasm libjpeg-turbo-devel libpng-devel libtiff-devel \
                 libwebp-devel git tar xz curl;

  # ---- libde265 (needed by libheif) ----
  git clone --depth 1 https://github.com/strukturag/libde265.git
  cd libde265 && ./autogen.sh && ./configure --prefix=/opt && make -j && make install
  cd ..

  # ---- libheif ----
  curl -L https://github.com/strukturag/libheif/releases/download/v1.17.6/libheif-1.17.6.tar.gz | tar xz
  cd libheif-* && ./configure --prefix=/opt && make -j && make install
  cd ..

  # ---- libvips with heif ----
  curl -L https://github.com/libvips/libvips/releases/download/v8.16.0/vips-8.16.0.tar.gz | tar xz
  cd vips-* && ./configure --prefix=/opt --with-heif --with-webp && make -j && make install
  cd ..

  # ---- sharp compile ----
  mkdir -p /work/pkg && cd /work/pkg
  npm init -y
  # Tell sharp to build from source and link to /opt/lib
  npm install sharp --build-from-source --sharp-cxx11=1 --sharp-libvips=8.16.0

'
echo "DONE; artefacts in $WORK"
