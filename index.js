const crypto = require('crypto');

// Network configurations - same message for all networks (like Bitcoin)
const NETWORK_CONFIGS = {
    mainnet: {
        nTime: 1752700800,        // Your mainnet timestamp
        nBits: 0x1e0ffff0,        // Higher difficulty
        nVersion: 1,
        genesisReward: 20 * 100000000, // 20 coins in satoshis
        message: "BitcoinNu Started on 17 Jul 2025"  // Same message for all networks
    },
    testnet: {
        nTime: 1752700900,        // 100 seconds later
        nBits: 0x1e0ffff0,        // Same difficulty as mainnet (or you can make it easier)
        nVersion: 1,
        genesisReward: 20 * 100000000,
        message: "BitcoinNu Started on 17 Jul 2025"  // Same message for all networks
    },
    signet: {
        nTime: 1752701000,        // 200 seconds later
        nBits: 0x1e0377ae,        // Much easier difficulty
        nVersion: 1,
        genesisReward: 20 * 100000000,
        message: "BitcoinNu Started on 17 Jul 2025"  // Same message for all networks
    },
    regtest: {
        nTime: 1752701100,        // 300 seconds later
        nBits: 0x207fffff,        // Minimal difficulty for instant mining
        nVersion: 1,
        genesisReward: 20 * 100000000,
        message: "BitcoinNu Started on 17 Jul 2025"  // Same message for all networks
    }
};

// Helper functions
function reverseBuffer(buffer) {
    const reversed = Buffer.alloc(buffer.length);
    for (let i = 0; i < buffer.length; i++) {
        reversed[i] = buffer[buffer.length - 1 - i];
    }
    return reversed;
}

function sha256(data) {
    return crypto.createHash('sha256').update(data).digest();
}

function doubleSha256(data) {
    return sha256(sha256(data));
}

function writeUInt32LE(value) {
    const buffer = Buffer.alloc(4);
    buffer.writeUInt32LE(value, 0);
    return buffer;
}

function writeUInt64LE(value) {
    const buffer = Buffer.alloc(8);
    buffer.writeUInt32LE(value & 0xffffffff, 0);
    buffer.writeUInt32LE(Math.floor(value / 0x100000000), 4);
    return buffer;
}

function writeVarInt(value) {
    if (value < 0xfd) {
        return Buffer.from([value]);
    } else if (value <= 0xffff) {
        const buffer = Buffer.alloc(3);
        buffer[0] = 0xfd;
        buffer.writeUInt16LE(value, 1);
        return buffer;
    } else if (value <= 0xffffffff) {
        const buffer = Buffer.alloc(5);
        buffer[0] = 0xfe;
        buffer.writeUInt32LE(value, 1);
        return buffer;
    } else {
        const buffer = Buffer.alloc(9);
        buffer[0] = 0xff;
        buffer.writeUInt32LE(value & 0xffffffff, 1);
        buffer.writeUInt32LE(Math.floor(value / 0x100000000), 5);
        return buffer;
    }
}

function createScriptSig(message) {
    const messageBuffer = Buffer.from(message, 'utf8');
    
    // 486604799 as 4-byte little-endian (this is the nBits value from original Bitcoin genesis)
    const nBitsBuffer = writeUInt32LE(486604799);
    
    // CScriptNum(4) - this pushes the number 4 as a single byte
    const scriptNumBuffer = Buffer.from([0x01, 0x04]); // PUSH 1 byte, then the value 4
    
    // Message as vector - need to push the length then the data
    const messageLengthBuffer = Buffer.from([messageBuffer.length]);
    
    // Construct the full scriptSig
    const scriptSig = Buffer.concat([
        Buffer.from([0x04]), // PUSH 4 bytes
        nBitsBuffer,         // 486604799
        scriptNumBuffer,     // CScriptNum(4)
        messageLengthBuffer, // message length
        messageBuffer        // message data
    ]);
    
    return scriptSig;
}

function createCoinbaseTransaction(config) {
    const message = config.message;
    const scriptSig = createScriptSig(message);
    
    // Create scriptPubKey: OP_RETURN (0x6a)
    const scriptPubKey = Buffer.from([0x6a]);
    
    // Build transaction
    const tx = Buffer.concat([
        writeUInt32LE(1), // version
        writeVarInt(1), // input count
        Buffer.alloc(32), // previous tx hash (null)
        writeUInt32LE(0xffffffff), // previous tx output index
        writeVarInt(scriptSig.length), // scriptSig length
        scriptSig, // scriptSig
        writeUInt32LE(0xffffffff), // sequence
        writeVarInt(1), // output count
        writeUInt64LE(config.genesisReward), // output value
        writeVarInt(scriptPubKey.length), // scriptPubKey length
        scriptPubKey, // scriptPubKey
        writeUInt32LE(0) // lock time
    ]);
    
    return tx;
}

function createBlockHeader(config, merkleRoot, nonce) {
    return Buffer.concat([
        writeUInt32LE(config.nVersion), // version
        Buffer.alloc(32), // previous block hash (null)
        merkleRoot, // merkle root
        writeUInt32LE(config.nTime), // timestamp
        writeUInt32LE(config.nBits), // bits
        writeUInt32LE(nonce) // nonce
    ]);
}

function getTargetFromBits(bits) {
    const exponent = bits >>> 24;
    const mantissa = bits & 0xffffff;
    const target = BigInt(mantissa) * (BigInt(256) ** BigInt(exponent - 3));
    return target;
}

function hashToBigInt(hash) {
    return BigInt('0x' + reverseBuffer(hash).toString('hex'));
}

function mineGenesisBlock(network) {
    const config = NETWORK_CONFIGS[network];
    if (!config) {
        console.error('Unknown network:', network);
        return;
    }
    
    console.log(`\n=== MINING ${network.toUpperCase()} GENESIS BLOCK ===`);
    console.log('Configuration:', config);
    console.log('Message:', config.message);
    console.log('');
    
    // Create coinbase transaction
    const coinbaseTx = createCoinbaseTransaction(config);
    const txHash = doubleSha256(coinbaseTx);
    const merkleRoot = txHash; // Only one transaction, so merkle root = tx hash
    
    console.log('Coinbase Transaction Hash:', txHash.toString('hex'));
    console.log('Merkle Root:', merkleRoot.toString('hex'));
    console.log('');
    
    // Calculate target
    const target = getTargetFromBits(config.nBits);
    console.log('Target:', target.toString(16));
    console.log('');
    
    // Mine for nonce
    let nonce = 0;
    let hash;
    const startTime = Date.now();
    
    while (true) {
        const blockHeader = createBlockHeader(config, merkleRoot, nonce);
        hash = doubleSha256(blockHeader);
        const hashInt = hashToBigInt(hash);
        
        if (hashInt <= target) {
            break;
        }
        
        nonce++;
        if (nonce % 10000 === 0) {
            process.stdout.write(`\rTrying nonce: ${nonce}`);
        }
    }
    
    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;
    
    console.log(`\n\nSuccess! Found valid nonce: ${nonce}`);
    console.log(`Mining took ${duration} seconds`);
    console.log('');
    
    // Output results
    console.log(`=== ${network.toUpperCase()} GENESIS BLOCK RESULTS ===`);
    console.log('Block Hash:', reverseBuffer(hash).toString('hex'));
    console.log('Merkle Root:', reverseBuffer(merkleRoot).toString('hex'));
    console.log('Nonce:', nonce);
    console.log('');
    
    // Output C++ code
    console.log(`=== ${network.toUpperCase()} C++ CODE ===`);
    console.log(`// ${network} genesis block`);
    console.log(`genesis = CreateGenesisBlock(${config.nTime}, ${nonce}, 0x${config.nBits.toString(16)}, ${config.nVersion}, ${config.genesisReward / 100000000} * COIN);`);
    console.log(`consensus.hashGenesisBlock = genesis.GetHash();`);
    console.log(`assert(consensus.hashGenesisBlock == uint256S("${reverseBuffer(hash).toString('hex')}"));`);
    console.log(`assert(genesis.hashMerkleRoot == uint256S("${reverseBuffer(merkleRoot).toString('hex')}"));`);
    console.log('');
    
    return {
        network,
        blockHash: reverseBuffer(hash).toString('hex'),
        merkleRoot: reverseBuffer(merkleRoot).toString('hex'),
        nonce,
        config
    };
}

// Main function
function main() {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        console.log('Usage: node genesis_miner.js <network>');
        console.log('Networks: mainnet, testnet, signet, regtest, all');
        console.log('');
        console.log('Example: node genesis_miner.js mainnet');
        console.log('Example: node genesis_miner.js all');
        return;
    }
    
    const network = args[0].toLowerCase();
    
    if (network === 'all') {
        console.log('Mining genesis blocks for all networks...');
        const results = [];
        
        for (const net of ['mainnet', 'testnet', 'signet', 'regtest']) {
            const result = mineGenesisBlock(net);
            results.push(result);
        }
        
        console.log('\n=== SUMMARY OF ALL NETWORKS ===');
        results.forEach(result => {
            console.log(`${result.network.toUpperCase()}:`);
            console.log(`  Hash: ${result.blockHash}`);
            console.log(`  Merkle: ${result.merkleRoot}`);
            console.log(`  Nonce: ${result.nonce}`);
            console.log(`  Time: ${result.config.nTime}`);
            console.log('');
        });
        
        console.log('=== COMPLETE C++ CODE FOR ALL NETWORKS ===');
        results.forEach(result => {
            console.log(`// ${result.network} genesis block`);
            console.log(`genesis = CreateGenesisBlock(${result.config.nTime}, ${result.nonce}, 0x${result.config.nBits.toString(16)}, ${result.config.nVersion}, ${result.config.genesisReward / 100000000} * COIN);`);
            console.log(`consensus.hashGenesisBlock = genesis.GetHash();`);
            console.log(`assert(consensus.hashGenesisBlock == uint256S("${result.blockHash}"));`);
            console.log(`assert(genesis.hashMerkleRoot == uint256S("${result.merkleRoot}"));`);
            console.log('');
        });
        
    } else if (NETWORK_CONFIGS[network]) {
        mineGenesisBlock(network);
    } else {
        console.error('Unknown network:', network);
        console.log('Available networks: mainnet, testnet, signet, regtest, all');
    }
}

// Run the script
main();