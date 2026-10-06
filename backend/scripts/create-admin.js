const readline = require('node:readline/promises');
const { stdin, stdout } = require('node:process');
const pool = require('../db/connection');
const { hashPassword } = require('../src/services/passwords');

function promptHidden(label) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    return Promise.reject(new Error('Run this command from an interactive terminal'));
  }

  stdout.write(label);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');

  return new Promise((resolve, reject) => {
    let value = '';

    function cleanup() {
      stdin.removeListener('data', onData);
      stdin.setRawMode(false);
      stdout.write('\n');
    }

    function onData(character) {
      if (character === '\u0003') {
        cleanup();
        reject(new Error('Cancelled'));
        return;
      }
      if (character === '\r' || character === '\n') {
        cleanup();
        resolve(value);
        return;
      }
      if (character === '\u007f' || character === '\b') {
        value = value.slice(0, -1);
        stdout.write('\b \b');
        return;
      }
      if (character >= ' ' && character !== '\u001b') {
        value += character;
        stdout.write('*');
      }
    }

    stdin.on('data', onData);
  });
}

async function main() {
  const terminal = readline.createInterface({ input: stdin, output: stdout });
  const usernameInput = await terminal.question('Admin username: ');
  terminal.close();

  const username = usernameInput.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,255}$/.test(username)) {
    throw new Error('Username must be 3–255 characters using letters, numbers, dots, underscores, or hyphens');
  }

  const password = await promptHidden('Admin password (12–128 characters): ');
  const confirmation = await promptHidden('Confirm password: ');
  if (password !== confirmation) {
    throw new Error('Passwords do not match');
  }

  const passwordHash = await hashPassword(password);
  const result = await pool.query(
    `INSERT INTO admins (username, password_hash, mfa_enabled)
     VALUES ($1, $2, FALSE)
     RETURNING id, username`,
    [username, passwordHash]
  );

  console.log(`Created admin account ${result.rows[0].username} (id ${result.rows[0].id}).`);
}

main()
  .catch((error) => {
    console.error(`Could not create admin: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
