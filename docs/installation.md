# Installation

Requirements: Node.js 20 or newer and npm.

```bash
npm install
npm run build
npm link
hackon --version
```

For a package check:

```bash
npm pack
mkdir /tmp/hackon-clean
cd /tmp/hackon-clean
npm init -y
npm install /absolute/path/to/hackon-stack/hackon-stack-0.1.0.tgz
npx hackon --version
```
