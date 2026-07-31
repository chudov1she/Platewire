import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { FormulaStoreService } from '../formula/formula-store.service.js';
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
    return rows.map((r) => this.serialize(r));
  }

  async getOne(id: string) {
    const row = await this.prisma.agentProposal.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Proposal not found');
    return this.serialize(row);
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
    return this.serialize(updated);
  }

  /** Human-only. Creates + activates a new FormulaVersion from the proposal's patch. */
  async apply(id: string) {
    const row = await this.prisma.agentProposal.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Proposal not found');
    if (row.status !== 'proposed') {
      throw new BadRequestException(`Cannot apply proposal in status=${row.status}`);
    }
    const created = await this.store.createVersion({
      fromVersionId: row.baselineVersionId,
      patch: row.patchJson as Record<string, unknown>,
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
    return this.serialize(updated);
  }

  private serialize(row: {
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
  }) {
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
    };
  }
}
