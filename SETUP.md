# ECC secp256k1 Messenger

A secure end-to-end encrypted messaging application using elliptic curve cryptography (secp256k1).

## Project Setup

This project uses:
- **React** for the UI
- **pnpm** for package management
- **esbuild** for fast bundling

## Installation

```bash
# Install dependencies
pnpm install
```

## Development

```bash
# Start development server with hot reload
pnpm dev
```

The app will be available at `http://localhost:3000`

## Build

```bash
# Create production build
pnpm build
```

The optimized bundle will be in the `dist/` directory.

## Project Structure

```
ecc/
├── public/
│   └── index.html          # HTML template
├── src/
│   ├── index.jsx           # Entry point
│   └── App.jsx             # Main application component
├── build.js                # esbuild configuration
├── package.json            # Dependencies and scripts
└── README.md              # This file
```

## Features

- **My Profiles**: Create multiple temporary or permanent identity profiles
- **Contacts**: Manage contacts using public keys or addresses
- **Encrypt**: Send encrypted messages to contacts
- **Decrypt**: Receive and decrypt messages using your profile
- **Base58 Encoding**: Convert between public keys and addresses
- **Expiring Profiles**: Optional auto-expiring temporary identities

## Technology

- **secp256k1**: The same elliptic curve used by Bitcoin
- **ECDH**: Elliptic Curve Diffie-Hellman for shared secret derivation
- **Base58**: Bitcoin-style address encoding
- **React**: Modern UI framework
- **Tailwind CSS**: Utility-first CSS (loaded via CDN)
- **Lucide React**: Icon library
