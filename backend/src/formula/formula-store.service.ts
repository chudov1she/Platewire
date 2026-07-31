import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  defaultFormulaSpec,
  normalizeFormulaSpec,
  patchFormulaSpec,
} from './formula-spec.js';
import type { FormulaSpec } from './formula.types.js';
import { availableEnvKeys } from './formula-registry.js';
import { FormulaRunnerService } from './formula-runner.service.js';
import { FORMULA_BASE_V42 } from './formula.types.js';

const PRODUCTION_ID = 1;

/**
 * Versioned FormulaSpec store. Versions are immutable; production is a
 * singleton pointer. Activation is human-only — the AI curation agent can
 * create versions via proposals but never has a tool to call `activate`.
 */
@Injectable()
export class FormulaStoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: FormulaRunnerService,
  ) {}

  async ensureSeed(): Promise<void> {
    const existing = await this.prisma.formulaVersion.findUnique({
      where: { versionLabel: 'v42-default' },
    });
    if (existing) {
      const pointer = await this.prisma.formulaProduction.findUnique({
        where: { id: PRODUCTION_ID },
      });
      if (!pointer) {
        await this.prisma.formulaProduction.create({
          data: { id: PRODUCTION_ID, versionId: existing.id },
        });
      }
      return;
    }
    const spec = defaultFormulaSpec();
    spec.version = 'v42-default';
    const row = await this.prisma.formulaVersion.create({
      data: {
        versionLabel: 'v42-default',
        base: FORMULA_BASE_V42,
        specJson: spec as unknown as Prisma.InputJsonValue,
        notes: 'Seeded default v42 FormulaSpec',
        createdBy: 'seed',
      },
    });
    await this.prisma.formulaProduction.upsert({
      where: { id: PRODUCTION_ID },
      create: { id: PRODUCTION_ID, versionId: row.id },
      update: { versionId: row.id },
    });
  }

  async getProduction() {
    await this.ensureSeed();
    const pointer = await this.prisma.formulaProduction.findUniqueOrThrow({
      where: { id: PRODUCTION_ID },
      include: { version: true },
    });
    const spec = normalizeFormulaSpec(pointer.version.specJson);
    return {
      versionId: pointer.version.id,
      versionLabel: pointer.version.versionLabel,
      base: pointer.version.base,
      spec,
      notes: pointer.version.notes,
      createdAt: pointer.version.createdAt.toISOString(),
      updatedAt: pointer.updatedAt.toISOString(),
      availableEnvKeys: availableEnvKeys(),
    };
  }

  async listVersions(limit = 50) {
    await this.ensureSeed();
    const pointer = await this.prisma.formulaProduction.findUnique({
      where: { id: PRODUCTION_ID },
    });
    const rows = await this.prisma.formulaVersion.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(200, Math.max(1, limit)),
    });
    return rows.map((row) => ({
      id: row.id,
      versionLabel: row.versionLabel,
      base: row.base,
      notes: row.notes,
      createdAt: row.createdAt.toISOString(),
      createdBy: row.createdBy,
      isProduction: pointer?.versionId === row.id,
    }));
  }

  async getVersion(id: string) {
    const row = await this.prisma.formulaVersion.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Formula version not found');
    const pointer = await this.prisma.formulaProduction.findUnique({
      where: { id: PRODUCTION_ID },
    });
    return {
      id: row.id,
      versionLabel: row.versionLabel,
      base: row.base,
      notes: row.notes,
      createdAt: row.createdAt.toISOString(),
      createdBy: row.createdBy,
      isProduction: pointer?.versionId === row.id,
      spec: normalizeFormulaSpec(row.specJson),
    };
  }

  async createVersion(body: {
    versionLabel?: string;
    spec?: unknown;
    patch?: Record<string, unknown>;
    fromVersionId?: string;
    notes?: string;
    activate?: boolean;
    createdBy?: string;
  }) {
    await this.ensureSeed();
    let baseSpec = defaultFormulaSpec();
    if (body.fromVersionId) {
      const from = await this.prisma.formulaVersion.findUnique({
        where: { id: body.fromVersionId },
      });
      if (!from) throw new NotFoundException('fromVersionId not found');
      baseSpec = normalizeFormulaSpec(from.specJson);
    } else if (body.spec) {
      baseSpec = normalizeFormulaSpec(body.spec);
    }
    if (body.patch) {
      baseSpec = patchFormulaSpec(baseSpec, body.patch);
    }

    const errors = this.runner.validate(baseSpec);
    if (errors.length) {
      throw new BadRequestException({ message: 'Invalid FormulaSpec', errors });
    }

    const versionLabel =
      body.versionLabel?.trim() ||
      `custom-${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random()
        .toString(36)
        .slice(2, 6)}`;

    baseSpec.version = versionLabel;
    baseSpec.base = baseSpec.base || FORMULA_BASE_V42;

    try {
      const row = await this.prisma.formulaVersion.create({
        data: {
          versionLabel,
          base: baseSpec.base,
          specJson: baseSpec as unknown as Prisma.InputJsonValue,
          notes: body.notes ?? null,
          createdBy: body.createdBy ?? 'human',
        },
      });
      if (body.activate) {
        await this.activate(row.id);
      }
      return this.getVersion(row.id);
    } catch (err) {
      if (
        err &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code: string }).code === 'P2002'
      ) {
        throw new ConflictException('versionLabel already exists');
      }
      throw err;
    }
  }

  async putProduction(body: {
    versionLabel?: string;
    spec?: unknown;
    patch?: Record<string, unknown>;
    fromVersionId?: string;
    notes?: string;
  }) {
    return this.createVersion({ ...body, activate: true, createdBy: 'human' });
  }

  /** Human-only activation. Never called from an AI tool. */
  async activate(versionId: string) {
    await this.ensureSeed();
    const row = await this.prisma.formulaVersion.findUnique({
      where: { id: versionId },
    });
    if (!row) throw new NotFoundException('Formula version not found');
    await this.prisma.formulaProduction.upsert({
      where: { id: PRODUCTION_ID },
      create: { id: PRODUCTION_ID, versionId: row.id },
      update: { versionId: row.id },
    });
    return this.getProduction();
  }

  async resolveSpec(opts: {
    versionId?: string;
    spec?: unknown;
  }): Promise<{
    spec: FormulaSpec;
    formulaVersionId: string | null;
    versionLabel: string;
    dryRun: boolean;
  }> {
    await this.ensureSeed();
    if (opts.spec != null) {
      const spec = normalizeFormulaSpec(opts.spec);
      const errors = this.runner.validate(spec);
      if (errors.length) {
        throw new BadRequestException({ message: 'Invalid FormulaSpec', errors });
      }
      return {
        spec,
        formulaVersionId: null,
        versionLabel: spec.version,
        dryRun: true,
      };
    }
    if (opts.versionId) {
      const row = await this.prisma.formulaVersion.findUnique({
        where: { id: opts.versionId },
      });
      if (!row) throw new NotFoundException('Formula version not found');
      return {
        spec: normalizeFormulaSpec(row.specJson),
        formulaVersionId: row.id,
        versionLabel: row.versionLabel,
        dryRun: false,
      };
    }
    const prod = await this.getProduction();
    return {
      spec: prod.spec,
      formulaVersionId: prod.versionId,
      versionLabel: prod.versionLabel,
      dryRun: false,
    };
  }
}
