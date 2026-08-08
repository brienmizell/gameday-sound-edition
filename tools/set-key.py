#!/usr/bin/env python3
"""Store the CFBD API key in .env without it appearing anywhere.

    cd ~/GameDay && python3 tools/set-key.py

The prompt is hidden, so the key never lands in your shell history, your
terminal scrollback, or a chat transcript. .env is gitignored, so it never
reaches the repo. Get a free key at https://collegefootballdata.com/key
"""
import getpass
import pathlib
import re
import sys

ENV = pathlib.Path('.env')
NAME = 'CFBD_API_KEY'
HEADER = (
    '# GameDay build-time secrets. Gitignored — nothing here ever ships.\n'
    '# https://collegefootballdata.com/key\n\n'
)


def main():
    if not pathlib.Path('tools').is_dir():
        sys.exit('Run this from the repo root:  cd ~/GameDay && python3 tools/set-key.py')

    # Without a terminal, getpass falls back to ECHOING what you type — which
    # would print the key into whatever is capturing the output, including an
    # agent transcript. Refuse instead. Run this in your own Terminal.
    if not sys.stdin.isatty():
        sys.exit(
            'Refusing to read a key without a terminal — the input would be echoed.\n'
            'Open Terminal.app and run:  cd ~/GameDay && python3 tools/set-key.py'
        )

    key = getpass.getpass('CFBD API key (input hidden, press Enter when pasted): ').strip()
    if not key:
        sys.exit('Nothing entered — no change made.')
    if key == 'PASTE_YOUR_KEY_HERE':
        sys.exit('That is the placeholder, not a key.')

    text = ENV.read_text() if ENV.exists() else HEADER
    line = f'{NAME}={key}'
    if re.search(rf'^{NAME}=.*$', text, re.M):
        text = re.sub(rf'^{NAME}=.*$', line, text, count=1, flags=re.M)
    else:
        text = text.rstrip('\n') + f'\n{line}\n'
    ENV.write_text(text)
    ENV.chmod(0o600)  # owner-only

    # Confirm shape without revealing it.
    print(f'Wrote {NAME} to .env — {len(key)} characters, ends "…{key[-4:]}", permissions 600.')
    print('Next:  python3 tools/build-series.py --week 1')


if __name__ == '__main__':
    main()
