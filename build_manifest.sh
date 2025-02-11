#!/bin/bash
# Source this file to define the PROJECTS variable, needed by build_local, used by bootstrap_docker.sh.
#
# PROJECT elements have structure PROJECT_NAME:WORKING_DIR:DOCKERFILE:REPO:LAUNCH.
#  PROJECT_NAME: A name by which one can reference this project via the boostrap_docker.sh script.
#  WORKING_DIR: Everything within this directory is copied into the docker context (excluding paths in .dockerignore).
#  DOCKERFILE: Defaults to Dockerfile. However some projects have multiple build Dockerfiles located in subdirs.
#  REPO: Defaults to <PROJECT_NAME>. The docker repository name, used to name the resulting docker image.
#  LAUNCH: If set, the container will be run. Use when testing is not done as part of the build.
#
# This file tells bootstrap_docker.sh which and in which order to build projects for locally testing the docker builds.
# To check *most* of the build works as expected, we can just do the minimum to produce the e2e tests, and run them
# locally to check they work. Other projects can be *temporarily* uncommented to test their Dockerfiles, but don't
# commit them, so that the most important build path remains fast and simple.

PROJECTS=(
  # bb-x86_64-linux-clang:barretenberg/cpp:./dockerfiles/Dockerfile.x86_64-linux-clang:barretenberg-x86_64-linux-clang
  # bb-x86_64-linux-clang-assert:barretenberg/cpp:./dockerfiles/Dockerfile.x86_64-linux-clang-assert:barretenberg-x86_64-linux-clang-assert
  # bb-x86_64-linux-gcc:barretenberg/cpp:./dockerfiles/Dockerfile.x86_64-linux-gcc:barretenberg-x86_64-linux-gcc
  bb-wasm-linux-clang:barretenberg/cpp:./dockerfiles/Dockerfile.wasm-linux-clang:barretenberg-wasm-linux-clang
  # bb-x86:barretenberg/cpp:./dockerfiles/Dockerfile.x86_64-linux-clang-assert:barretenberg-x86_64-linux-clang-assert
  # bb.js:barretenberg/ts:Dockerfile:bb.js::1
  # run-acir-tests-bb:barretenberg/acir_tests:Dockerfile.bb
  # run-acir-tests-bb.js:barretenberg/acir_tests:Dockerfile.bb.js
  # circuits-x86_64-linux-clang:circuits/cpp:./dockerfiles/Dockerfile.x86_64-linux-clang:circuits-x86_64-linux-clang
  # circuits-x86_64-linux-clang-assert:circuits/cpp:./dockerfiles/Dockerfile.x86_64-linux-clang-assert:circuits-x86_64-linux-clang-assert
  circuits-wasm-linux-clang:circuits/cpp:./dockerfiles/Dockerfile.wasm-linux-clang:circuits-wasm-linux-clang
  l1-contracts:l1-contracts
  noir-contracts:yarn-project:noir-contracts/Dockerfile.build:noir-contracts-build
  yarn-project-base:yarn-project:yarn-project-base/Dockerfile
  noir-contracts:yarn-project
  end-to-end:yarn-project
  aztec-sandbox:yarn-project
)
