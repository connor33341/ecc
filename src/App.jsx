import React, { useState, useEffect } from 'react';
import { KeyRound, Plus, Trash2, Lock, Unlock, Clock, Copy, Check, User, Users } from 'lucide-react';
import * as secp256k1 from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { hmac } from '@noble/hashes/hmac';
import bs58 from 'bs58';

// Set up the hash function for secp256k1
secp256k1.utils.sha256Sync = (...messages) => {
  return sha256.create().update(secp256k1.utils.concatBytes(...messages)).digest();
};

const App = () => {
  const [myProfiles, setMyProfiles] = useState([]);
  const [contactProfiles, setContactProfiles] = useState([]);
  const [activeProfile, setActiveProfile] = useState(null);
  const [message, setMessage] = useState('');
  const [encryptedMessage, setEncryptedMessage] = useState('');
  const [decryptedMessage, setDecryptedMessage] = useState('');
  const [selectedRecipient, setSelectedRecipient] = useState('');
  const [copiedId, setCopiedId] = useState(null);
  const [activeTab, setActiveTab] = useState('encrypt');
  const [theme, setTheme] = useState('purple');
  const [showSettings, setShowSettings] = useState(false);
  const [consoleLogs, setConsoleLogs] = useState([]);
  const [copyFormat, setCopyFormat] = useState('full'); // 'full', 'lifetime', 'plain'

  // Generate a random private key and derive public key
  const generateKeyPair = () => {
    const privateKey = secp256k1.utils.randomPrivateKey();
    const publicKey = secp256k1.getPublicKey(privateKey, true); // compressed format
    return { privateKey, publicKey };
  };

  // Derive address from public key (compressed format with base58)
  const deriveAddress = (publicKey) => {
    // Public key is already in compressed format (33 bytes)
    console.log('Generating address from public key:', Array.from(publicKey).map(b => b.toString(16).padStart(2, '0')).join(''));
    const address = bs58.encode(publicKey);
    console.log('Generated address:', address);
    
    // Validate that the address doesn't contain invalid characters
    const base58Chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    for (let char of address) {
      if (!base58Chars.includes(char)) {
        console.error('Invalid character in generated address:', char, 'Address:', address);
        console.error('bs58 library:', bs58);
        throw new Error(`Generated address contains invalid Base58 character: '${char}'. This should never happen with the bs58 library!`);
      }
    }
    
    return address;
  };

  // Derive public key from address
  const derivePublicKeyFromAddress = (address) => {
    try {
      // Validate base58 characters first
      const base58Chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
      const invalidChars = [];
      for (let char of address) {
        if (!base58Chars.includes(char)) {
          invalidChars.push(char);
        }
      }
      
      if (invalidChars.length > 0) {
        throw new Error(
          `Invalid Base58 character(s): ${[...new Set(invalidChars)].map(c => `'${c}'`).join(', ')}. ` +
          `Note: Base58 excludes 0, O, I, l to avoid confusion. This address may be from an older version - please create a new profile.`
        );
      }
      
      const publicKey = bs58.decode(address);
      if (publicKey.length !== 33) {
        throw new Error('Invalid address length');
      }
      // Verify it's a valid compressed public key
      const prefix = publicKey[0];
      if (prefix !== 0x02 && prefix !== 0x03) {
        throw new Error('Invalid public key prefix');
      }
      return publicKey;
    } catch (e) {
      throw new Error('Invalid address: ' + e.message);
    }
  };

  // ECIES encryption (Elliptic Curve Integrated Encryption Scheme)
  const encryptMessage = async (msg, recipientPubKey) => {
    try {
      // Generate ephemeral key pair
      const ephemeralPrivKey = secp256k1.utils.randomPrivateKey();
      const ephemeralPubKey = secp256k1.getPublicKey(ephemeralPrivKey, true);
      
      // Compute shared secret using ECDH
      const sharedPoint = secp256k1.getSharedSecret(ephemeralPrivKey, recipientPubKey);
      
      // Derive encryption key using KDF (we'll use the x-coordinate + HMAC)
      const sharedSecret = sharedPoint.slice(1, 33); // Extract x-coordinate (skip 0x04 prefix)
      
      // Use HMAC-SHA256 as KDF to derive encryption key
      const encryptionKey = hmac(sha256, sharedSecret, new TextEncoder().encode('encryption'));
      
      // Convert message to bytes
      const messageBytes = new TextEncoder().encode(msg);
      
      // Simple XOR cipher with the derived key (for production, use AES-GCM)
      const ciphertext = new Uint8Array(messageBytes.length);
      for (let i = 0; i < messageBytes.length; i++) {
        ciphertext[i] = messageBytes[i] ^ encryptionKey[i % encryptionKey.length];
      }
      
      // Return encrypted data
      return JSON.stringify({
        ephemeralPubKey: Array.from(ephemeralPubKey).map(b => b.toString(16).padStart(2, '0')).join(''),
        ciphertext: Array.from(ciphertext).map(b => b.toString(16).padStart(2, '0')).join('')
      });
    } catch (e) {
      throw new Error('Encryption failed: ' + e.message);
    }
  };

  // ECIES decryption
  const decryptMessage = async (encryptedData, privateKey) => {
    try {
      const data = JSON.parse(encryptedData);
      
      // Parse ephemeral public key
      const ephemeralPubKey = new Uint8Array(
        data.ephemeralPubKey.match(/.{1,2}/g).map(byte => parseInt(byte, 16))
      );
      
      // Parse ciphertext
      const ciphertext = new Uint8Array(
        data.ciphertext.match(/.{1,2}/g).map(byte => parseInt(byte, 16))
      );
      
      // Compute shared secret using ECDH
      const sharedPoint = secp256k1.getSharedSecret(privateKey, ephemeralPubKey);
      
      // Derive encryption key (same KDF as encryption)
      const sharedSecret = sharedPoint.slice(1, 33); // Extract x-coordinate
      const encryptionKey = hmac(sha256, sharedSecret, new TextEncoder().encode('encryption'));
      
      // Decrypt using XOR
      const messageBytes = new Uint8Array(ciphertext.length);
      for (let i = 0; i < ciphertext.length; i++) {
        messageBytes[i] = ciphertext[i] ^ encryptionKey[i % encryptionKey.length];
      }
      
      // Convert back to string
      return new TextDecoder().decode(messageBytes);
    } catch (e) {
      return 'Decryption failed: ' + e.message;
    }
  };

  const createProfile = (name, expiresIn = 30) => {
    const { privateKey, publicKey } = generateKeyPair();
    const address = deriveAddress(publicKey);
    const expiresAt = expiresIn ? Date.now() + expiresIn * 60000 : null;
    
    const profile = {
      id: Date.now().toString(),
      name,
      privateKey: Array.from(privateKey).map(b => b.toString(16).padStart(2, '0')).join(''),
      publicKey: Array.from(publicKey).map(b => b.toString(16).padStart(2, '0')).join(''),
      address,
      expiresAt,
      createdAt: Date.now()
    };
    
    setMyProfiles(prev => [...prev, profile]);
    return profile;
  };

  const addContact = (name, publicKeyInput, addressInput) => {
    try {
      let publicKey, address, expiresAt = null;
      
      if (addressInput && !publicKeyInput) {
        // Check if address has time appended
        // Format 1: address:lifetime:timestamp (3 parts)
        // Format 2: address:lifetime (2 parts)
        // Format 3: address (1 part)
        let actualAddress = addressInput.trim();
        const timeParts = actualAddress.split(':');
        
        if (timeParts.length === 3) {
          // Full format: address:lifetime:timestamp
          actualAddress = timeParts[0].trim();
          const lifetime = parseInt(timeParts[1]);
          const timestamp = parseInt(timeParts[2]);
          
          if (!isNaN(lifetime) && !isNaN(timestamp) && lifetime > 0) {
            // Calculate expiration from creation time + lifetime
            expiresAt = timestamp + (lifetime * 60000);
            
            // Check if already expired
            if (expiresAt <= Date.now()) {
              console.warn('Warning: Contact was created at', new Date(timestamp).toISOString(), 'and has already expired');
              // Still allow adding but it will be auto-removed
            }
          }
        } else if (timeParts.length === 2) {
          // Legacy format: address:lifetime
          actualAddress = timeParts[0].trim();
          const minutes = parseInt(timeParts[1]);
          if (!isNaN(minutes) && minutes > 0) {
            expiresAt = Date.now() + minutes * 60000;
          }
        }
        // else: plain address, no expiration
        
        // Derive public key from address
        const pubKeyBytes = derivePublicKeyFromAddress(actualAddress);
        publicKey = Array.from(pubKeyBytes).map(b => b.toString(16).padStart(2, '0')).join('');
        address = actualAddress;
      } else if (publicKeyInput && !addressInput) {
        // Derive address from public key
        const pubKeyBytes = new Uint8Array(
          publicKeyInput.match(/.{1,2}/g).map(byte => parseInt(byte, 16))
        );
        address = deriveAddress(pubKeyBytes);
        publicKey = publicKeyInput;
      } else if (publicKeyInput) {
        // Both provided
        publicKey = publicKeyInput;
        address = addressInput || deriveAddress(
          new Uint8Array(publicKeyInput.match(/.{1,2}/g).map(byte => parseInt(byte, 16)))
        );
      } else {
        throw new Error('Must provide either public key or address');
      }
      
      const contact = {
        id: Date.now().toString(),
        name,
        publicKey,
        address,
        expiresAt,
        createdAt: Date.now()
      };
      setContactProfiles(prev => [...prev, contact]);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  };

  const removeProfile = (id, isContact = false) => {
    if (isContact) {
      setContactProfiles(prev => prev.filter(p => p.id !== id));
    } else {
      setMyProfiles(prev => prev.filter(p => p.id !== id));
      if (activeProfile?.id === id) setActiveProfile(null);
    }
  };

  const handleEncrypt = async () => {
    if (!message || !selectedRecipient) return;
    
    const recipient = contactProfiles.find(c => c.id === selectedRecipient);
    if (!recipient) return;
    
    try {
      const recipientPubKey = new Uint8Array(
        recipient.publicKey.match(/.{1,2}/g).map(byte => parseInt(byte, 16))
      );
      
      const encrypted = await encryptMessage(message, recipientPubKey);
      setEncryptedMessage(encrypted);
    } catch (e) {
      setEncryptedMessage('Encryption failed: ' + e.message);
    }
  };

  const handleDecrypt = async () => {
    if (!encryptedMessage || !activeProfile) return;
    
    // Check if profile has expired
    if (activeProfile.expiresAt && activeProfile.expiresAt <= Date.now()) {
      setDecryptedMessage('❌ Cannot decrypt: Profile has expired');
      return;
    }
    
    try {
      const privateKey = new Uint8Array(
        activeProfile.privateKey.match(/.{1,2}/g).map(byte => parseInt(byte, 16))
      );
      
      const decrypted = await decryptMessage(encryptedMessage, privateKey);
      setDecryptedMessage(decrypted);
    } catch (e) {
      setDecryptedMessage('Decryption failed: ' + e.message);
    }
  };

  const copyToClipboard = async (text, id) => {
    console.log('Copying to clipboard:', text);
    console.log('Text length:', text.length);
    console.log('Contains uppercase:', /[A-Z]/.test(text));
    
    try {
      // Try modern clipboard API first
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for older browsers or iOS issues
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        
        try {
          document.execCommand('copy');
          textArea.remove();
        } catch (err) {
          console.error('Fallback copy failed:', err);
          textArea.remove();
        }
      }
      
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
      console.log('Copy completed successfully');
    } catch (err) {
      console.error('Copy failed:', err);
    }
  };

  const getRemainingTime = (expiresAt) => {
    if (!expiresAt) return null;
    const remaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    const interval = setInterval(() => {
      // Remove expired profiles and contacts
      setMyProfiles(prev => prev.filter(p => !p.expiresAt || p.expiresAt > Date.now()));
      setContactProfiles(prev => prev.filter(c => !c.expiresAt || c.expiresAt > Date.now()));
    }, 1000);
    
    // Clean up any profiles with invalid Base58 addresses on mount
    const base58Chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    const isValidBase58 = (str) => {
      if (!str) return false;
      for (let char of str) {
        if (!base58Chars.includes(char)) {
          console.warn(`Invalid Base58 character '${char}' found in address: ${str}`);
          return false;
        }
      }
      return true;
    };
    
    setMyProfiles(prev => {
      const invalid = prev.filter(p => !isValidBase58(p.address));
      if (invalid.length > 0) {
        console.warn('Removed invalid profiles:', invalid.map(p => p.name));
      }
      return prev.filter(p => isValidBase58(p.address));
    });
    
    setContactProfiles(prev => {
      const invalid = prev.filter(c => !isValidBase58(c.address));
      if (invalid.length > 0) {
        console.warn('Removed invalid contacts:', invalid.map(c => c.name));
      }
      return prev.filter(c => isValidBase58(c.address));
    });
    
    return () => clearInterval(interval);
  }, []);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showContactForm, setShowContactForm] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [expirationEnabled, setExpirationEnabled] = useState(true);
  const [expirationMinutes, setExpirationMinutes] = useState(30);
  const [newContactName, setNewContactName] = useState('');
  const [newContactPubKey, setNewContactPubKey] = useState('');
  const [newContactAddress, setNewContactAddress] = useState('');
  const [contactInputMode, setContactInputMode] = useState('address'); // 'pubkey' or 'address'
  const [contactError, setContactError] = useState('');

  const themes = {
    purple: { name: 'Purple', primary: '#a855f7', secondary: '#9333ea', gradient: 'from-slate-900 via-purple-900 to-slate-900' },
    blue: { name: 'Blue', primary: '#3b82f6', secondary: '#2563eb', gradient: 'from-slate-900 via-blue-900 to-slate-900' },
    green: { name: 'Green', primary: '#10b981', secondary: '#059669', gradient: 'from-slate-900 via-emerald-900 to-slate-900' },
    red: { name: 'Red', primary: '#f43f5e', secondary: '#e11d48', gradient: 'from-slate-900 via-rose-900 to-slate-900' },
    orange: { name: 'Orange', primary: '#f97316', secondary: '#ea580c', gradient: 'from-slate-900 via-orange-900 to-slate-900' },
    cyan: { name: 'Cyan', primary: '#06b6d4', secondary: '#0891b2', gradient: 'from-slate-900 via-cyan-900 to-slate-900' },
    dark: { name: 'Dark', primary: '#6b7280', secondary: '#4b5563', gradient: 'from-black via-gray-900 to-black' }
  };

  const currentTheme = themes[theme];

  // Capture console logs
  useEffect(() => {
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;

    console.log = (...args) => {
      setConsoleLogs(prev => [...prev.slice(-99), { type: 'log', message: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '), time: new Date().toLocaleTimeString() }]);
      originalLog.apply(console, args);
    };

    console.error = (...args) => {
      setConsoleLogs(prev => [...prev.slice(-99), { type: 'error', message: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '), time: new Date().toLocaleTimeString() }]);
      originalError.apply(console, args);
    };

    console.warn = (...args) => {
      setConsoleLogs(prev => [...prev.slice(-99), { type: 'warn', message: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '), time: new Date().toLocaleTimeString() }]);
      originalWarn.apply(console, args);
    };

    return () => {
      console.log = originalLog;
      console.error = originalError;
      console.warn = originalWarn;
    };
  }, []);

  return (
    <div className={`min-h-screen bg-gradient-to-br ${currentTheme.gradient} p-4`}>
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-8 pt-8">
          <div className="flex items-center justify-center gap-3 mb-3 relative">
            <KeyRound className="w-10 h-10" style={{ color: currentTheme.primary }} />
            <h1 className="text-4xl font-bold text-white">ECC secp256k1 Messenger</h1>
            <button
              onClick={() => setShowSettings(true)}
              className="absolute right-0 p-2 rounded-lg transition-all hover:opacity-80"
              style={{ backgroundColor: currentTheme.primary }}
              title="Settings"
            >
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </div>
          <p className="text-purple-300" style={{ color: currentTheme.primary }}>Secure end-to-end encrypted messaging with @noble/secp256k1</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* My Profiles */}
          <div className="bg-white/10 backdrop-blur-lg rounded-xl p-6 border border-purple-500/30">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <User className="w-5 h-5" style={{ color: currentTheme.primary }} />
                <h2 className="text-xl font-semibold text-white">My Profiles</h2>
              </div>
              <button
                onClick={() => setShowCreateForm(!showCreateForm)}
                style={{ backgroundColor: currentTheme.primary }}
                className="p-2 rounded-lg transition-colors hover:opacity-90"
              >
                <Plus className="w-5 h-5 text-white" />
              </button>
            </div>

            {showCreateForm && (
              <div className="mb-4 p-4 bg-black/30 rounded-lg space-y-3">
                <input
                  type="text"
                  placeholder="Profile name"
                  value={newProfileName}
                  onChange={(e) => setNewProfileName(e.target.value)}
                  className="w-full px-3 py-2 bg-white/10 border border-purple-500/30 rounded-lg text-white placeholder-purple-300/50"
                />
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={expirationEnabled}
                    onChange={(e) => setExpirationEnabled(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <span className="text-purple-300" style={{ color: currentTheme.primary }}>Enable expiration</span>
                </div>
                {expirationEnabled && (
                  <input
                    type="number"
                    placeholder="Minutes"
                    value={expirationMinutes}
                    onChange={(e) => setExpirationMinutes(parseInt(e.target.value) || 30)}
                    className="w-full px-3 py-2 bg-white/10 border border-purple-500/30 rounded-lg text-white"
                    style={{ borderColor: currentTheme.primary + '50' }}
                  />
                )}
                <button
                  onClick={() => {
                    if (newProfileName) {
                      createProfile(newProfileName, expirationEnabled ? expirationMinutes : null);
                      setNewProfileName('');
                      setShowCreateForm(false);
                    }
                  }}
                  style={{ backgroundColor: currentTheme.primary }}
                  className="w-full px-4 py-2 rounded-lg text-white transition-colors hover:opacity-90"
                >
                  Create Profile
                </button>
              </div>
            )}

            <div className="space-y-3 max-h-96 overflow-y-auto">
              {myProfiles.map(profile => (
                <div
                  key={profile.id}
                  onClick={() => setActiveProfile(profile)}
                  className={`p-4 rounded-lg cursor-pointer transition-all ${
                    activeProfile?.id === profile.id
                      ? 'border-2'
                      : 'bg-white/5 border border-purple-500/20 hover:bg-white/10'
                  }`}
                  style={{
                    backgroundColor: activeProfile?.id === profile.id ? currentTheme.primary + '30' : undefined,
                    borderColor: activeProfile?.id === profile.id ? currentTheme.primary : undefined
                  }}
                >
                  <div className="flex items-start justify-between mb-2">
                    <span className="font-semibold text-white">{profile.name}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeProfile(profile.id);
                      }}
                      className="p-1 hover:bg-red-500/20 rounded"
                    >
                      <Trash2 className="w-4 h-4 text-red-400" />
                    </button>
                  </div>
                  <div className="text-xs space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-purple-300" style={{ color: currentTheme.primary }}>Address:</span>
                      <input
                        type="text"
                        value={profile.address}
                        readOnly
                        onClick={(e) => e.target.select()}
                        className="text-white font-mono text-xs bg-transparent border-none outline-none w-24 cursor-pointer"
                        title="Click to select, then manually copy"
                      />
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          let addressToCopy;
                          const remainingMinutes = profile.expiresAt 
                            ? Math.max(0, Math.ceil((profile.expiresAt - Date.now()) / 60000))
                            : null;
                          
                          if (copyFormat === 'full' && profile.createdAt && remainingMinutes !== null) {
                            // Full format: address:lifetime:timestamp
                            addressToCopy = `${profile.address}:${remainingMinutes}:${profile.createdAt}`;
                          } else if (copyFormat === 'lifetime' && remainingMinutes !== null) {
                            // Legacy format: address:lifetime
                            addressToCopy = `${profile.address}:${remainingMinutes}`;
                          } else {
                            // Plain address
                            addressToCopy = profile.address;
                          }
                          
                          copyToClipboard(addressToCopy, profile.id + 'addr');
                        }}
                        className="p-1 rounded"
                        style={{ backgroundColor: 'transparent' }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = currentTheme.primary + '30'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                      >
                        {copiedId === profile.id + 'addr' ? (
                          <Check className="w-3 h-3 text-green-400" />
                        ) : (
                          <Copy className="w-3 h-3" style={{ color: currentTheme.primary }} />
                        )}
                      </button>
                    </div>
                    {profile.expiresAt && (
                      <div className="flex items-center gap-2 text-yellow-400">
                        <Clock className="w-3 h-3" />
                        <span>{getRemainingTime(profile.expiresAt)}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Main Area */}
          <div className="lg:col-span-2 space-y-6">
            {/* Tabs */}
            <div className="bg-white/10 backdrop-blur-lg rounded-xl p-2 border border-purple-500/30 flex gap-2" style={{ borderColor: currentTheme.primary + '50' }}>
              <button
                onClick={() => setActiveTab('encrypt')}
                style={{
                  backgroundColor: activeTab === 'encrypt' ? currentTheme.primary : 'transparent',
                  color: activeTab === 'encrypt' ? 'white' : currentTheme.primary
                }}
                className="flex-1 px-4 py-3 rounded-lg transition-all flex items-center justify-center gap-2 hover:bg-white/5"
              >
                <Lock className="w-5 h-5" />
                Encrypt
              </button>
              <button
                onClick={() => setActiveTab('decrypt')}
                style={{
                  backgroundColor: activeTab === 'decrypt' ? currentTheme.primary : 'transparent',
                  color: activeTab === 'decrypt' ? 'white' : currentTheme.primary
                }}
                className="flex-1 px-4 py-3 rounded-lg transition-all flex items-center justify-center gap-2 hover:bg-white/5"
              >
                <Unlock className="w-5 h-5" />
                Decrypt
              </button>
            </div>

            {/* Encrypt Tab */}
            {activeTab === 'encrypt' && (
              <div className="bg-white/10 backdrop-blur-lg rounded-xl p-6 border border-purple-500/30 space-y-4">
                <h3 className="text-xl font-semibold text-white mb-4">Encrypt Message</h3>
                <select
                  value={selectedRecipient}
                  onChange={(e) => setSelectedRecipient(e.target.value)}
                  className="w-full px-4 py-3 bg-white/10 border border-purple-500/30 rounded-lg text-white"
                >
                  <option value="">Select recipient...</option>
                  {contactProfiles.map(contact => (
                    <option key={contact.id} value={contact.id}>{contact.name}</option>
                  ))}
                </select>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Enter message to encrypt..."
                  className="w-full px-4 py-3 bg-white/10 border border-purple-500/30 rounded-lg text-white placeholder-purple-300/50 h-32 resize-none"
                />
                <button
                  onClick={handleEncrypt}
                  style={{ backgroundColor: currentTheme.primary }}
                  className="w-full px-6 py-3 rounded-lg text-white font-semibold transition-colors hover:opacity-90"
                >
                  Encrypt Message
                </button>
                {encryptedMessage && (
                  <div className="p-4 bg-black/30 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-purple-300 text-sm">Encrypted Message:</span>
                      <button
                        onClick={() => copyToClipboard(encryptedMessage, 'encrypted')}
                        className="p-2 rounded"
                        style={{ backgroundColor: 'transparent' }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = currentTheme.primary + '30'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                      >
                        {copiedId === 'encrypted' ? (
                          <Check className="w-4 h-4 text-green-400" />
                        ) : (
                          <Copy className="w-4 h-4" style={{ color: currentTheme.primary }} />
                        )}
                      </button>
                    </div>
                    <pre className="text-white text-xs overflow-x-auto whitespace-pre-wrap break-all">
                      {encryptedMessage}
                    </pre>
                  </div>
                )}
              </div>
            )}

            {/* Decrypt Tab */}
            {activeTab === 'decrypt' && (
              <div className="bg-white/10 backdrop-blur-lg rounded-xl p-6 border border-purple-500/30 space-y-4">
                <h3 className="text-xl font-semibold text-white mb-4">Decrypt Message</h3>
                {activeProfile ? (
                  <div 
                    className="p-3 border rounded-lg"
                    style={{
                      backgroundColor: activeProfile.expiresAt && activeProfile.expiresAt <= Date.now() 
                        ? '#dc262620' 
                        : currentTheme.primary + '30',
                      borderColor: activeProfile.expiresAt && activeProfile.expiresAt <= Date.now() 
                        ? '#dc2626' 
                        : currentTheme.primary
                    }}
                  >
                    <span className="text-purple-300 text-sm" style={{ color: currentTheme.primary }}>Using profile: </span>
                    <span className="text-white font-semibold">{activeProfile.name}</span>
                    {activeProfile.expiresAt && activeProfile.expiresAt <= Date.now() && (
                      <span className="text-red-400 text-xs ml-2">⚠️ EXPIRED</span>
                    )}
                  </div>
                ) : (
                  <div className="p-3 bg-yellow-600/20 border border-yellow-500/30 rounded-lg text-yellow-300 text-sm">
                    Please select a profile to decrypt messages
                  </div>
                )}
                <textarea
                  value={encryptedMessage}
                  onChange={(e) => setEncryptedMessage(e.target.value)}
                  placeholder="Paste encrypted message here..."
                  className="w-full px-4 py-3 bg-white/10 border border-purple-500/30 rounded-lg text-white placeholder-purple-300/50 h-32 resize-none"
                />
                <button
                  onClick={handleDecrypt}
                  disabled={!activeProfile}
                  style={{ backgroundColor: activeProfile ? currentTheme.primary : '#6b7280' }}
                  className="w-full px-6 py-3 rounded-lg text-white font-semibold transition-colors hover:opacity-90 disabled:cursor-not-allowed"
                >
                  Decrypt Message
                </button>
                {decryptedMessage && (
                  <div className="p-4 bg-black/30 rounded-lg">
                    <span className="text-purple-300 text-sm block mb-2" style={{ color: currentTheme.primary }}>Decrypted Message:</span>
                    <p className="text-white">{decryptedMessage}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Contacts */}
        <div className="mt-6 bg-white/10 backdrop-blur-lg rounded-xl p-6 border border-purple-500/30">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5" style={{ color: currentTheme.primary }} />
              <h2 className="text-xl font-semibold text-white">Contacts</h2>
            </div>
            <button
              onClick={() => setShowContactForm(!showContactForm)}
              style={{ backgroundColor: currentTheme.primary }}
              className="p-2 rounded-lg transition-colors hover:opacity-90"
            >
              <Plus className="w-5 h-5 text-white" />
            </button>
          </div>

          {showContactForm && (
            <div className="mb-4 p-4 bg-black/30 rounded-lg space-y-3">
              <input
                type="text"
                placeholder="Contact name"
                value={newContactName}
                onChange={(e) => setNewContactName(e.target.value)}
                className="w-full px-3 py-2 bg-white/10 border border-purple-500/30 rounded-lg text-white placeholder-purple-300/50"
              />
              
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setContactInputMode('pubkey');
                    setContactError('');
                  }}
                  style={{
                    backgroundColor: contactInputMode === 'pubkey' ? currentTheme.primary : 'rgba(255,255,255,0.05)',
                    color: contactInputMode === 'pubkey' ? 'white' : currentTheme.primary
                  }}
                  className="flex-1 px-3 py-2 rounded-lg transition-colors hover:opacity-90"
                >
                  Public Key
                </button>
                <button
                  onClick={() => {
                    setContactInputMode('address');
                    setContactError('');
                  }}
                  style={{
                    backgroundColor: contactInputMode === 'address' ? currentTheme.primary : 'rgba(255,255,255,0.05)',
                    color: contactInputMode === 'address' ? 'white' : currentTheme.primary
                  }}
                  className="flex-1 px-3 py-2 rounded-lg transition-colors hover:opacity-90"
                >
                  Address
                </button>
              </div>

              {contactInputMode === 'pubkey' ? (
                <input
                  type="text"
                  placeholder="Public Key (66 hex chars, compressed)"
                  value={newContactPubKey}
                  onChange={(e) => setNewContactPubKey(e.target.value.replace(/[^0-9a-fA-F]/g, '').toLowerCase())}
                  className="w-full px-3 py-2 bg-white/10 border border-purple-500/30 rounded-lg text-white placeholder-purple-300/50 font-mono text-sm"
                />
              ) : (
                <>
                  <input
                    type="text"
                    placeholder="Address (Base58 encoded) or address:minutes"
                    value={newContactAddress}
                    onChange={(e) => setNewContactAddress(e.target.value.trim())}
                    className="w-full px-3 py-2 bg-white/10 border border-purple-500/30 rounded-lg text-white placeholder-purple-300/50 font-mono text-sm"
                  />
                  <div className="text-xs" style={{ color: currentTheme.primary + 'b0' }}>
                    💡 Formats: address:minutes or address:minutes:timestamp
                  </div>
                </>
              )}
              
              {contactError && (
                <div className="p-2 bg-red-500/20 border border-red-500/30 rounded text-red-300 text-sm">
                  {contactError}
                </div>
              )}
              
              {newContactAddress && newContactAddress.split(':').length === 3 && (() => {
                const parts = newContactAddress.split(':');
                const lifetime = parseInt(parts[1]);
                const timestamp = parseInt(parts[2]);
                if (!isNaN(lifetime) && !isNaN(timestamp)) {
                  const expiresAt = timestamp + (lifetime * 60000);
                  if (expiresAt <= Date.now()) {
                    return (
                      <div className="p-2 bg-yellow-500/20 border border-yellow-500/30 rounded text-yellow-300 text-sm">
                        ⚠️ Warning: This contact has already expired (created {new Date(timestamp).toLocaleString()})
                      </div>
                    );
                  }
                }
                return null;
              })()}
              
              <button
                onClick={() => {
                  setContactError('');
                  if (!newContactName) {
                    setContactError('Please enter a contact name');
                    return;
                  }
                  
                  let result;
                  if (contactInputMode === 'pubkey') {
                    if (!newContactPubKey) {
                      setContactError('Please enter a public key');
                      return;
                    }
                    if (newContactPubKey.length !== 66) {
                      setContactError('Public key must be 66 hex characters (compressed format)');
                      return;
                    }
                    result = addContact(newContactName, newContactPubKey, null);
                  } else {
                    if (!newContactAddress) {
                      setContactError('Please enter an address');
                      return;
                    }
                    result = addContact(newContactName, null, newContactAddress);
                  }
                  
                  if (result.success) {
                    setNewContactName('');
                    setNewContactPubKey('');
                    setNewContactAddress('');
                    setShowContactForm(false);
                  } else {
                    setContactError(result.error);
                  }
                }}
                style={{ backgroundColor: currentTheme.primary }}
                className="w-full px-4 py-2 rounded-lg text-white transition-colors hover:opacity-90"
              >
                Add Contact
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {contactProfiles.map(contact => (
              <div
                key={contact.id}
                className="p-4 bg-white/5 border border-purple-500/20 rounded-lg hover:bg-white/10 transition-all"
              >
                <div className="flex items-start justify-between mb-2">
                  <span className="font-semibold text-white">{contact.name}</span>
                  <button
                    onClick={() => removeProfile(contact.id, true)}
                    className="p-1 hover:bg-red-500/20 rounded"
                  >
                    <Trash2 className="w-4 h-4 text-red-400" />
                  </button>
                </div>
                <div className="text-xs space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-purple-300" style={{ color: currentTheme.primary }}>Address:</span>
                    <span className="text-white font-mono text-xs break-all">{contact.address?.slice(0, 15)}...</span>
                    <button
                      onClick={() => copyToClipboard(contact.address, contact.id + 'addr')}
                      className="p-1 rounded flex-shrink-0"
                      style={{ backgroundColor: 'transparent' }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = currentTheme.primary + '30'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                      {copiedId === contact.id + 'addr' ? (
                        <Check className="w-3 h-3 text-green-400" />
                      ) : (
                        <Copy className="w-3 h-3" style={{ color: currentTheme.primary }} />
                      )}
                    </button>
                  </div>
                  {contact.expiresAt && (
                    <div className="flex items-center gap-2 text-yellow-400">
                      <Clock className="w-3 h-3" />
                      <span>{getRemainingTime(contact.expiresAt)}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Settings Modal */}
        {showSettings && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowSettings(false)}>
            <div className="bg-slate-900 rounded-2xl border border-white/20 max-w-4xl w-full max-h-[90vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
              {/* Header */}
              <div className="flex items-center justify-between p-6 border-b border-white/10">
                <h2 className="text-2xl font-bold text-white">Settings</h2>
                <button
                  onClick={() => setShowSettings(false)}
                  className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                >
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="overflow-y-auto max-h-[calc(90vh-80px)]">
                {/* Theme Selector */}
                <div className="p-6 border-b border-white/10">
                  <h3 className="text-lg font-semibold text-white mb-4">Theme</h3>
                  <div className="flex flex-wrap gap-3">
                    {Object.keys(themes).map(themeName => (
                      <button
                        key={themeName}
                        onClick={() => setTheme(themeName)}
                        style={{
                          backgroundColor: theme === themeName ? themes[themeName].primary : 'rgba(255,255,255,0.05)',
                          color: theme === themeName ? 'white' : 'rgba(255,255,255,0.7)'
                        }}
                        className={`px-4 py-2 rounded-lg font-medium transition-all ${
                          theme === themeName ? 'shadow-lg scale-105' : 'hover:bg-white/10'
                        }`}
                      >
                        {themes[themeName].name}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Copy Format Setting */}
                <div className="p-6 border-b border-white/10">
                  <h3 className="text-lg font-semibold text-white mb-4">Address Copy Format</h3>
                  <div className="space-y-2">
                    <label className="flex items-center gap-3 p-3 bg-white/5 rounded-lg cursor-pointer hover:bg-white/10 transition-colors">
                      <input
                        type="radio"
                        name="copyFormat"
                        value="full"
                        checked={copyFormat === 'full'}
                        onChange={(e) => setCopyFormat(e.target.value)}
                        className="w-4 h-4"
                        style={{ accentColor: currentTheme.primary }}
                      />
                      <div>
                        <div className="text-white font-medium">Full (address:lifetime:timestamp)</div>
                        <div className="text-sm text-gray-400">Includes creation time for accurate expiration</div>
                      </div>
                    </label>
                    
                    <label className="flex items-center gap-3 p-3 bg-white/5 rounded-lg cursor-pointer hover:bg-white/10 transition-colors">
                      <input
                        type="radio"
                        name="copyFormat"
                        value="lifetime"
                        checked={copyFormat === 'lifetime'}
                        onChange={(e) => setCopyFormat(e.target.value)}
                        className="w-4 h-4"
                        style={{ accentColor: currentTheme.primary }}
                      />
                      <div>
                        <div className="text-white font-medium">Lifetime (address:minutes)</div>
                        <div className="text-sm text-gray-400">Simple format with remaining time</div>
                      </div>
                    </label>
                    
                    <label className="flex items-center gap-3 p-3 bg-white/5 rounded-lg cursor-pointer hover:bg-white/10 transition-colors">
                      <input
                        type="radio"
                        name="copyFormat"
                        value="plain"
                        checked={copyFormat === 'plain'}
                        onChange={(e) => setCopyFormat(e.target.value)}
                        className="w-4 h-4"
                        style={{ accentColor: currentTheme.primary }}
                      />
                      <div>
                        <div className="text-white font-medium">Plain (address only)</div>
                        <div className="text-sm text-gray-400">Just the address without expiration info</div>
                      </div>
                    </label>
                  </div>
                </div>

                {/* Console Logs */}
                <div className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-white">Console</h3>
                    <button
                      onClick={() => setConsoleLogs([])}
                      className="px-3 py-1 bg-red-600 hover:bg-red-700 rounded text-white text-sm transition-colors"
                    >
                      Clear
                    </button>
                  </div>
                  <div className="bg-black/50 rounded-lg p-4 font-mono text-xs max-h-96 overflow-y-auto">
                    {consoleLogs.length === 0 ? (
                      <div className="text-gray-500">No logs yet...</div>
                    ) : (
                      consoleLogs.map((log, i) => (
                        <div
                          key={i}
                          className={`mb-2 pb-2 border-b border-white/5 ${
                            log.type === 'error' ? 'text-red-400' :
                            log.type === 'warn' ? 'text-yellow-400' :
                            'text-green-400'
                          }`}
                        >
                          <span className="text-gray-500">[{log.time}]</span>
                          <span className="ml-2 font-semibold">[{log.type.toUpperCase()}]</span>
                          <div className="text-white mt-1 break-all">{log.message}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;