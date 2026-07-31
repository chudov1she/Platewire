import 'dotenv/config';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const game = await prisma.game.findFirst({ where: { mlbGamePk: 822947 } });
const del = await prisma.f5OddsSnapshot.deleteMany({
  where: { gameId: game.id, stage: 'inn1' },
});
console.log('deleted', del.count);
await prisma.$disconnect();
await pool.end();
