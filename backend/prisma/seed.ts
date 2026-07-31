import 'dotenv/config';
import bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, UserStatus } from '../src/generated/prisma/client.js';

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL as string,
});
const prisma = new PrismaClient({ adapter });

async function main() {
  const login = process.env.ADMIN_LOGIN ?? 'admin';
  const password = process.env.ADMIN_PASSWORD ?? 'admin';
  const passwordHash = await bcrypt.hash(password, 10);

  await prisma.user.upsert({
    where: { login },
    update: {
      passwordHash,
      status: UserStatus.ADMIN,
      displayName: 'Admin',
    },
    create: {
      login,
      passwordHash,
      status: UserStatus.ADMIN,
      displayName: 'Admin',
    },
  });

  console.log(`Admin user ensured: login=${login}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
