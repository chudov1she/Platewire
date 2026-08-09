import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { FormulaStoreService } from '../formula/formula-store.service.js';
import { patchFormulaSpec } from '../formula/formula-spec.js';
import { FormulaRunnerService } from '../formula/formula-runner.service.js';
import { LedgerBacktestService } from '../ledger/ledger-backtest.service.js';

/**
 * A proposal is cheap to create (just a backtest snapshot) and requires a
 * separate, explicit human `apply` call to ever touch production. The AI
 * curation agent only ever has access to `create` (via its
 * propose_formula_patch tool) — `apply` is intentionally not exposed to it.
 */
@Injectable()
export class AgentProposalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: FormulaStoreService,
    private readonly backtest: LedgerBacktestService,
    private readonly runner: FormulaRunnerService,
  ) {}

  async create(opts: {
    title: string;
    rationale: string;
    patch: Record<string, unknown>;
    days?: number;
    track?: string;
  }) {
    const compared = await this.backtest.comparePatch(opts.patch, {
      days: opts.days,
      track: opts.track,
    });
    const row = await this.prisma.agentProposal.create({
      data: {
        title: opts.title,
        rationale: opts.rationale,
        patchJson: opts.patch as unknown as Prisma.InputJsonValue,
        baselineVersionId: compared.baselineVersionId,
        baselineMetricsJson: compared.baseline as unknown as Prisma.InputJsonValue,
        proposedMetricsJson: compared.proposed as unknown as Prisma.InputJsonValue,
      },
    });
    return this.serialize(row);
  }

  async list(limit = 20) {
    const rows = await this.prisma.agentProposal.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(100, Math.max(1, limit)),
    });
    const production = await this.store.getProduction();
    return rows.map((r) => this.serialize(r, production.versionId));
  }

  async getOne(id: string) {
    const row = await this.prisma.agentProposal.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Proposal not found');
    const production = await this.store.getProduction();
    return this.serialize(row, production.versionId);
  }

  /**
   * Resolve the proposal patch against current production, validate, and
   * optionally re-run a live ledger backtest so the UI can confirm before apply.
   */
  async preview(id: string, opts?: { days?: number; track?: string; liveBacktest?: boolean }) {
    const row = await this.prisma.agentProposal.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Proposal not found');
    const production = await this.store.getProduction();
    const patch = row.patchJson as Record<string, unknown>;
    const resolvedSpec = patchFormulaSpec(production.spec, patch);
    const validationErrors = this.runner.validate(resolvedSpec);
    const baselineStale = row.baselineVersionId !== production.versionId;

    let live: Awaited<ReturnType<LedgerBacktestService['comparePatch']>> | null =
      null;
    if (opts?.liveBacktest !== false) {
      live = await this.backtest.comparePatch(patch, {
        days: opts?.days,
        track: opts?.track,
      });
    }

    return {
      proposal: this.serialize(row, production.versionId),
      productionVersionId: production.versionId,
      productionVersionLabel: production.versionLabel,
      baselineStale,
      validationErrors,
      resolvedSpec,
      liveBacktest: live
        ? {
            baseline: live.baseline,
            proposed: live.proposed,
            sample: live.sample,
            baselineVersionId: live.baselineVersionId,
            baselineVersionLabel: live.baselineVersionLabel,
          }
        : null,
    };
  }

  async reject(id: string) {
    const row = await this.prisma.agentProposal.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Proposal not found');
    if (row.status !== 'proposed') {
      throw new BadRequestException(`Cannot reject proposal in status=${row.status}`);
    }
    const updated = await this.prisma.agentProposal.update({
      where: { id },
      data: { status: 'rejected' },
    });
    const production = await this.store.getProduction();
    return this.serialize(updated, production.versionId);
  }

  /**
   * Human-only. Patches CURRENT production (not the frozen create-time
   * baseline), creates + activates a FormulaVersion, then marks the proposal
   * applied. Applying onto current production avoids silently rewinding later
   * accepted patches when older proposals are approved out of order.
   */
  async apply(id: string) {
    const row = await this.prisma.agentProposal.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Proposal not found');
    if (row.status !== 'proposed') {
      throw new BadRequestException(`Cannot apply proposal in status=${row.status}`);
    }

    const production = await this.store.getProduction();
    const patch = row.patchJson as Record<string, unknown>;
    const resolved = patchFormulaSpec(production.spec, patch);
    const validationErrors = this.runner.validate(resolved);
    if (validationErrors.length) {
      throw new BadRequestException({
        message: 'Invalid FormulaSpec',
        errors: validationErrors,
      });
    }

    const created = await this.store.createVersion({
      fromVersionId: production.versionId,
      patch,
      versionLabel: `proposal-${row.id.slice(0, 8)}`,
      notes: `Applied from AgentProposal ${row.id}: ${row.title}`,
      activate: true,
      createdBy: 'ai-proposal-approved',
    });
    const updated = await this.prisma.agentProposal.update({
      where: { id },
      data: {
        status: 'applied',
        appliedAt: new Date(),
        createdFormulaVersionId: created.id,
      },
    });
    return {
      ...this.serialize(updated, created.id),
      createdVersion: created,
    };
  }

  private serialize(
    row: {
      id: string;
      status: string;
      title: string;
      rationale: string;
      patchJson: unknown;
      baselineVersionId: string;
      baselineMetricsJson: unknown;
      proposedMetricsJson: unknown;
      createdFormulaVersionId: string | null;
      appliedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    },
    productionVersionId?: string,
  ) {
    return {
      id: row.id,
      status: row.status,
      title: row.title,
      rationale: row.rationale,
      patch: row.patchJson,
      baselineVersionId: row.baselineVersionId,
      baselineMetrics: row.baselineMetricsJson,
      proposedMetrics: row.proposedMetricsJson,
      createdFormulaVersionId: row.createdFormulaVersionId,
      appliedAt: row.appliedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      baselineStale:
        productionVersionId != null
          ? row.baselineVersionId !== productionVersionId &&
            row.status === 'proposed'
          : undefined,
    };
  }
}
