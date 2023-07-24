#!/usr/bin/env python3
# Copyright (c) 2021 The Bitcoin Core developers
# Distributed under the MIT software license, see the accompanying
# file COPYING or http://www.opensource.org/licenses/mit-license.php.

"""
This checks that all files in the repository have correct filenames and permissions
"""

import os
import re
import sys
from subprocess import check_output
from typing import Dict, NoReturn, Optional

CMD_TOP_LEVEL = ["git", "rev-parse", "--show-toplevel"]
CMD_ALL_FILES = ["git", "ls-files", "-z", "--full-name", "--stage"]
CMD_SHEBANG_FILES = ["git", "grep", "--full-name", "--line-number", "-I", "^#!"]

ALL_SOURCE_FILENAMES_REGEXP = r"^.*\.(cpp|h|py|sh|rs)$"
ALLOWED_FILENAME_REGEXP = "^[a-zA-Z0-9/_.@][a-zA-Z0-9/_.@-]*$"
ALLOWED_SOURCE_FILENAME_REGEXP = "^[a-z0-9_./-]+$"
ALLOWED_PERMISSION_NON_EXECUTABLES = 0o644
ALLOWED_PERMISSION_EXECUTABLES = 0o755
ALLOWED_EXECUTABLE_SHEBANG = {
    "py": [b"#!/usr/bin/env python3"],
    "sh": [b"#!/usr/bin/env bash", b"#!/bin/sh"],
}

# Exceptions

# Global exceptions, none of the tests are run on these files.
THIRD_PARTY_DIR = "contrib/gitian-builder/"

# JS files are treated as common files rather than source files, as they frequently
# use mixedCase in their names.
ALLOWED_FILENAME_EXCEPTION = "web/e.cash/pages/blog/[slug].js"
ALLOWED_SOURCE_FILENAME_EXCEPTION_REGEXPS = (
    "^src/(secp256k1/|univalue/|test/fuzz/FuzzedDataProvider.h)",
    "^cmake/utils/EventCheckVersion.cpp$",
    "^contrib/buildbot/test/test_endpoint_",
)
# Executable files that may not have a standard shebang
ALLOWED_PERMISSION_EXECUTABLES_EXCEPTIONS = (
    # Windows PowerShell script
    "contrib/teamcity/run-tests-windows.ps1",
)


class FileMeta(object):
    def __init__(self, file_spec: str):
        """Parse a `git ls files --stage` output line."""
        # 100755 5a150d5f8031fcd75e80a4dd9843afa33655f579 0       ci/test/00_setup_env.sh
        meta_str, self.file_path = file_spec.split("\t", 2)
        meta = meta_str.split()
        # The octal file permission of the file. Internally, git only
        # keeps an 'executable' bit, so this will always be 0o644 or 0o755.
        self.permissions = int(meta[0], 8) & 0o7777
        # We don't currently care about the other fields

    @property
    def extension(self) -> Optional[str]:
        """
        Returns the file extension for a given filename string.
        eg:
        'ci/lint_run_all.sh' -> 'sh'
        'ci/retry/retry' -> None
        'contrib/devtools/split-debug.sh.in' -> 'in'
        """
        return str(os.path.splitext(self.file_path)[1].strip(".") or None)

    @property
    def full_extension(self) -> Optional[str]:
        """
        Returns the full file extension for a given filename string.
        eg:
        'ci/lint_run_all.sh' -> 'sh'
        'ci/retry/retry' -> None
        'contrib/devtools/split-debug.sh.in' -> 'sh.in'
        """
        filename_parts = self.file_path.split(os.extsep, 1)
        return filename_parts[1] if len(filename_parts) >= 2 else None


def get_git_file_metadata() -> Dict[str, FileMeta]:
    """
    Return a dictionary mapping the name of all files in the repository to git tree
    metadata.
    """
    files_raw = check_output(CMD_ALL_FILES).decode("utf8").rstrip("\0").split("\0")
    files = {}
    for file_spec in files_raw:
        meta = FileMeta(file_spec)
        if meta.file_path.startswith(THIRD_PARTY_DIR):
            continue
        files[meta.file_path] = meta
    return files


def check_all_filenames(files) -> int:
    """
    Checks every file in the repository against an allowed regexp to make sure only
    lowercase or uppercase alphanumerics (a-zA-Z0-9), underscores (_), hyphens (-),
    at (@) and dots (.) are used in repository filenames.
    """
    filenames = files.keys()
    filename_regex = re.compile(ALLOWED_FILENAME_REGEXP)
    failed_tests = 0
    for filename in filenames:
        if (
            not filename_regex.match(filename)
            and filename != ALLOWED_FILENAME_EXCEPTION
        ):
            print(
                f'File "{filename!r}" does not not match the allowed filename regexp '
                f"('{ALLOWED_FILENAME_REGEXP}')."
            )
            failed_tests += 1
    return failed_tests


def check_source_filenames(files) -> int:
    """
    Checks only source files (*.cpp, *.h, *.py, *.sh, *.rs) against a stricter allowed
    regexp to make sure only lowercase alphanumerics (a-z0-9), underscores (_),
    hyphens (-) and dots (.) are used in source code filenames.

    Additionally there is an exception regexp for directories or files which are
    excepted from matching this regexp.

    *.js files are not tested here, as they frequently use mixedCase names
    """
    filenames = [
        filename
        for filename in files.keys()
        if re.match(ALL_SOURCE_FILENAMES_REGEXP, filename, re.IGNORECASE)
    ]
    filename_regex = re.compile(ALLOWED_SOURCE_FILENAME_REGEXP)
    failed_tests = 0
    for filename in filenames:

        def filename_matches_exception(exception_regex: str) -> Optional[re.Match[str]]:
            filename_exception_regex = re.compile(exception_regex)
            return filename_exception_regex.match(filename)

        if not filename_regex.match(filename) and not any(
            filename_matches_exception(regex)
            for regex in ALLOWED_SOURCE_FILENAME_EXCEPTION_REGEXPS
        ):
            print(
                f'File "{filename!r}" does not not match the allowed source filename '
                f"regex ('{ALLOWED_SOURCE_FILENAME_REGEXP}') or the exception regex"
            )
            failed_tests += 1
    return failed_tests


def check_all_file_permissions(files) -> int:
    """
    Checks all files in the repository match an allowed executable or non-executable
    file permission octal.

    Additionally checks that for executable files, the file contains a shebang line
    """
    failed_tests = 0
    for filename, file_meta in files.items():
        if file_meta.permissions == ALLOWED_PERMISSION_EXECUTABLES:
            with open(filename, "rb") as f:
                shebang = f.readline().rstrip(b"\n")

            # For any file with executable permissions the first line must contain a shebang
            if (
                not shebang.startswith(b"#!")
                and filename not in ALLOWED_PERMISSION_EXECUTABLES_EXCEPTIONS
            ):
                print(
                    f'File "{filename}" has permission {ALLOWED_PERMISSION_EXECUTABLES:03o}'
                    f"(executable) and is thus expected to contain a shebang '#!'. Add "
                    f'shebang or do "chmod {ALLOWED_PERMISSION_NON_EXECUTABLES:03o} '
                    f'{filename}" to make it non-executable.'
                )
                failed_tests += 1

            # For certain file extensions that have been defined, we also check that
            # the shebang conforms to a specific allowable set of shebangs
            if (
                file_meta.extension in ALLOWED_EXECUTABLE_SHEBANG.keys()
                and filename not in ALLOWED_PERMISSION_EXECUTABLES_EXCEPTIONS
            ):
                if shebang not in ALLOWED_EXECUTABLE_SHEBANG[file_meta.extension]:
                    print(
                        f'File "{filename}" is missing expected shebang '
                        + " or ".join(
                            [
                                x.decode("utf-8")
                                for x in ALLOWED_EXECUTABLE_SHEBANG[file_meta.extension]
                            ]
                        )
                    )
                    failed_tests += 1

        elif file_meta.permissions == ALLOWED_PERMISSION_NON_EXECUTABLES:
            continue
        else:
            print(
                f'File "{filename}" has unexpected permission {file_meta.permissions}.'
                f' Do "chmod {ALLOWED_PERMISSION_NON_EXECUTABLES:03o} {filename}" (if '
                f'non-executable) or "chmod {ALLOWED_PERMISSION_EXECUTABLES:03o} '
                f'{filename}" (if executable).'
            )
            failed_tests += 1

    return failed_tests


def check_shebang_file_permissions(files_meta) -> int:
    """
    Checks every file that contains a shebang line to ensure it has an executable
    permission
    """
    filenames = check_output(CMD_SHEBANG_FILES).decode("utf8").strip().split("\n")

    # The git grep command we use returns files which contain a shebang on any line
    # within the file so we need to filter the list to only files with the shebang on
    # the first line
    filenames = [
        filename.split(":1:")[0]
        for filename in filenames
        if ":1:" in filename and not filename.startswith(THIRD_PARTY_DIR)
    ]

    failed_tests = 0
    for filename in filenames:
        file_meta = files_meta[filename]
        if file_meta.permissions != ALLOWED_PERMISSION_EXECUTABLES:
            # These file types are typically expected to be sourced and not executed
            # directly
            if file_meta.full_extension in ["bash", "init", "openrc", "sh.in"]:
                continue

            print(
                f'File "{filename}" contains a shebang line, but has the file '
                f"permission {file_meta.permissions} instead of the expected "
                f"executable permission {ALLOWED_PERMISSION_EXECUTABLES:03o}. Do "
                f'"chmod {ALLOWED_PERMISSION_EXECUTABLES:03o} {filename}" (or remove '
                f"the shebang line)."
            )
            failed_tests += 1
    return failed_tests


def main() -> NoReturn:
    root_dir = check_output(CMD_TOP_LEVEL).decode("utf8").strip()
    os.chdir(root_dir)

    files = get_git_file_metadata()

    failed_tests = 0
    failed_tests += check_all_filenames(files)
    failed_tests += check_source_filenames(files)
    failed_tests += check_all_file_permissions(files)
    failed_tests += check_shebang_file_permissions(files)

    if failed_tests:
        # Specific errors are printed on stdout in the various functions above
        sys.exit(1)
    else:
        # There should be no stdout in case of success
        sys.exit(0)


if __name__ == "__main__":
    main()