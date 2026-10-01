import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors({ origin: true, credentials: true });

  app.setGlobalPrefix('api/v1', {
    exclude: [
      { path: 'docs', method: RequestMethod.GET },
      { path: 'openapi-json', method: RequestMethod.GET },
      { path: 'mcp/:token', method: RequestMethod.ALL },
    ],
  });

  const config = new DocumentBuilder()
    .setTitle('Platewire API')
    .setDescription(
      'MLB collector: games, players, weather, and Winline F5 lines. Read via /api/v1 or MCP /mcp/<token>.',
    )
    .setVersion('0.1.0')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  const port = Number(process.env.PORT ?? 8000);
  await app.listen(port);
  console.log(`Platewire listening on http://localhost:${port}`);
  console.log(`Docs: http://localhost:${port}/docs`);
}

void bootstrap();
