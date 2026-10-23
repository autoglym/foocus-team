// Creates the first OWNER user and a #general channel in an empty database.
// Registration requires an invite, so a fresh production database needs one
// owner who can then create invite links from the Admin panel.
//
// Usage (DATABASE_URL must point at the target database/schema):
//   npm run create-owner -- --email you@company.com --name "Your Name"
// The password is asked for interactively and never echoed.
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { parseArgs } from 'util';

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
  },
});

if (!values.email || !values.name) {
  console.error('Usage: npm run create-owner -- --email you@company.com --name "Your Name"');
  process.exit(1);
}

function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(question);
    let input = '';
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (ch: string) => {
      if (ch === '\r' || ch === '\n' || ch === '\u0004') {
        stdin.setRawMode?.(false);
        stdin.pause();
        stdin.off('data', onData);
        process.stdout.write('\n');
        resolve(input);
      } else if (ch === '\u0003') {
        process.exit(130);
      } else if (ch === '\u007f') {
        input = input.slice(0, -1);
      } else {
        input += ch;
      }
    };
    stdin.on('data', onData);
  });
}

const prisma = new PrismaClient();

async function main() {
  const email = values.email!.toLowerCase();
  if (await prisma.user.findUnique({ where: { email } })) {
    console.error(`A user with email ${email} already exists.`);
    process.exit(1);
  }

  const password = await askHidden('Password (min 8 characters): ');
  if (password.length < 8 || password.length > 72) {
    console.error('Password must be 8–72 characters.');
    process.exit(1);
  }
  if ((await askHidden('Repeat password: ')) !== password) {
    console.error('Passwords do not match.');
    process.exit(1);
  }

  const user = await prisma.user.create({
    data: {
      email,
      name: values.name!,
      password: await bcrypt.hash(password, 10),
      role: 'OWNER',
    },
  });

  const general = await prisma.channel.upsert({
    where: { name: 'general' },
    update: {},
    create: { name: 'general', createdBy: user.id },
  });
  await prisma.channelMember.create({
    data: { userId: user.id, channelId: general.id, role: 'OWNER' },
  });

  console.log(`Created owner ${email} and #general. Log in and create invite links under Admin.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
