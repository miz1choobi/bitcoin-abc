#!/usr/bin/env python3
# Copyright (c) 2019 The Bitcoin Core developers
# Distributed under the MIT software license, see the accompanying
# file COPYING or http://www.opensource.org/licenses/mit-license.php.
"""Run fuzz test targets.
"""

import argparse
import configparser
import logging
import os
import subprocess
import sys

# Fuzzers known to lack a seed corpus in
# https://github.com/Bitcoin-ABC/qa-assets/tree/master/fuzz_seed_corpus
FUZZERS_MISSING_CORPORA = [
]


def main():
    parser = argparse.ArgumentParser(
        formatter_class=argparse.ArgumentDefaultsHelpFormatter)
    parser.add_argument(
        "-l",
        "--loglevel",
        dest="loglevel",
        default="INFO",
        help="log events at this level and higher to the console. Can be set to DEBUG, INFO, WARNING, ERROR or CRITICAL. Passing --loglevel DEBUG will output all logs to console.",
    )
    parser.add_argument(
        '--export_coverage',
        action='store_true',
        help='If true, export coverage information to files in the seed corpus',
    )
    parser.add_argument(
        'seed_dir',
        help='The seed corpus to run on (must contain subfolders for each fuzz target).',
    )
    parser.add_argument(
        'target',
        nargs='*',
        help='The target(s) to run. Default is to run all targets.',
    )

    args = parser.parse_args()

    # Set up logging
    logging.basicConfig(
        format='%(message)s',
        level=int(args.loglevel) if args.loglevel.isdigit(
        ) else args.loglevel.upper(),
    )

    # Read config generated by configure.
    config = configparser.ConfigParser()
    configfile = os.path.abspath(os.path.dirname(__file__)) + "/../config.ini"
    config.read_file(open(configfile, encoding="utf8"))

    if not config["components"].getboolean("ENABLE_FUZZ"):
        logging.error("Must have fuzz targets built")
        sys.exit(1)
    test_dir = os.path.join(
        config["environment"]["BUILDDIR"], 'src', 'test', 'fuzz')

    # Build list of tests
    test_list_all = [
        f for f in os.listdir(test_dir)
        if os.path.isfile(os.path.join(test_dir, f)) and
        os.access(os.path.join(test_dir, f), os.X_OK)]

    if not test_list_all:
        logging.error("No fuzz targets found")
        sys.exit(1)

    logging.info("Fuzz targets found: {}".format(test_list_all))

    # By default run all
    args.target = args.target or test_list_all
    test_list_error = list(set(args.target).difference(set(test_list_all)))
    if test_list_error:
        logging.error(
            "Unknown fuzz targets selected: {}".format(test_list_error))
    test_list_selection = list(
        set(test_list_all).intersection(set(args.target)))
    if not test_list_selection:
        logging.error("No fuzz targets selected")
    logging.info("Fuzz targets selected: {}".format(test_list_selection))

    try:
        help_output = subprocess.run(
            args=[
                os.path.join(test_dir, test_list_selection[0]),
                '-help=1',
            ],
            timeout=10,
            check=True,
            stderr=subprocess.PIPE,
            universal_newlines=True,
        ).stderr
        if "libFuzzer" not in help_output:
            logging.error("Must be built with libFuzzer")
            sys.exit(1)
    except subprocess.TimeoutExpired:
        logging.error(
            "subprocess timed out: Currently only libFuzzer is supported")
        sys.exit(1)

    run_once(
        corpus=args.seed_dir,
        test_list=test_list_selection,
        test_dir=test_dir,
        export_coverage=args.export_coverage,
    )


def run_once(*, corpus, test_list, test_dir, export_coverage):
    for t in test_list:
        corpus_path = os.path.join(corpus, t)
        if t in FUZZERS_MISSING_CORPORA:
            os.makedirs(corpus_path, exist_ok=True)
        args = [
            os.path.join(test_dir, t),
            '-runs=1',
            '-detect_leaks=0',
            corpus_path,
        ]
        logging.debug('Run {} with args {}'.format(t, args))
        result = subprocess.run(
            args,
            stderr=subprocess.PIPE,
            universal_newlines=True)
        output = result.stderr
        logging.debug('Output: {}'.format(output))
        result.check_returncode()
        if not export_coverage:
            continue
        for line in output.splitlines():
            if 'INITED' in line:
                with open(os.path.join(corpus, t + '_coverage'), 'w', encoding='utf-8') as cov_file:
                    cov_file.write(line)
                    break


if __name__ == '__main__':
    main()
