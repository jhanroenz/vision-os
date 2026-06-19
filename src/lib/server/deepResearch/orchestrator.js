import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { fetchPageHtml, htmlToText } from "../fetchWebPage.js";
import { preflightBrainForQuestion } from "../webSearchMemory.js";
import { buildBrainPreflightBrief } from "../webSearchMemory.js";
import { getTierBudget, normalizeResearchTier } from "./tiers.js";
import { createSessionMemory } from "./sessionMemory.js";
import { buildResearchPlan, suggestFollowUpQueries } from "./queryGenerator.js";
import { runResearchSearch, planResearchSearchEngines } from "./searchRunner.js";
import { attachPageText } from "./sourceStore.js";
import { extractClaimsFromSource, detectSimpleContradictions } from "./extractor.js";
import { harvestMediaFromHtml } from "./mediaHarvester.js";
import { classifyResearchTopic } from "./classifyResearchTopic.js";
import { synthesizeResearchReport } from "./synthesizer.js";
import { cleanResearchReportMarkdown } from "./reportMarkdown.js";
import { assembleResearchDocument } from "./documentAssembler.js";
import { buildResearchReportJson } from "./reportBuilder.js";
import {
  createResearchSession,
  updateResearchSession,
} from "./repository.js";

/**
 * @param {{ message: string, tier?: string }} opts
 */
export async function* streamDeepResearch({
  message,
  tier = "standard",
}) {
  const userQuery = String(message ?? "").trim();
  if (!userQuery) {
    yield { type: "error", error: "Research query is required." };
    return;
  }

  const normalizedTier = normalizeResearchTier(tier);
  const budget = getTierBudget(normalizedTier);
  const sessionId = randomUUID();
  const memory = createSessionMemory(sessionId);

  const plan = buildResearchPlan(userQuery);

  createResearchSession({
    id: sessionId,
    userQuery,
    tier: normalizedTier,
    plan,
  });

  yield {
    type: "research_session",
    sessionId,
    tier: normalizedTier,
    query: userQuery,
  };

  yield {
    type: "research_plan",
    plan: {
      ...plan,
      tier: normalizedTier,
      budget,
    },
  };

  updateResearchSession(sessionId, { status: "collecting", plan_json: JSON.stringify(plan) });

  let brainBaseline = "";
  try {
    const brainHit = await preflightBrainForQuestion(sessionId, userQuery);
    if (brainHit) {
      brainBaseline = buildBrainPreflightBrief(brainHit, userQuery);
      yield {
        type: "research_brain",
        title: brainHit.title,
        content: brainHit.content?.slice(0, 500),
      };
    }
  } catch {
    // optional
  }

  const queries = [...plan.queries];
  let iteration = 0;

  while (
    iteration < budget.maxIterations &&
    memory.searchesPerformed < budget.maxSearches &&
    memory.sources.length < budget.maxSources
  ) {
    iteration += 1;

    const batch = queries.splice(0, queries.length);
    if (!batch.length && iteration > 1) break;

    for (const q of batch) {
      if (memory.searchesPerformed >= budget.maxSearches) break;
      if (memory.sources.length >= budget.maxSources) break;

      const engines = planResearchSearchEngines(memory);

      yield {
        type: "research_search",
        query: q.q,
        category: q.category,
        iteration,
        engines: engines ?? null,
      };

      let result;
      try {
        result = await runResearchSearch({
          memory,
          query: q.q,
          category: q.category,
          sessionId,
          budget,
        });
      } catch (error) {
        yield {
          type: "research_search_error",
          query: q.q,
          error: error.message,
        };
        continue;
      }

      if (result.skipped) continue;

      for (const source of result.sourcesAdded) {
        yield { type: "research_source", source };
      }
      for (const asset of result.mediaAdded) {
        yield { type: "research_media", media: asset };
      }

      yield {
        type: "research_progress",
        iteration,
        searches: memory.searchesPerformed,
        sources: memory.sources.length,
        media: memory.media.length,
        budget: {
          maxSearches: budget.maxSearches,
          maxSources: budget.maxSources,
        },
      };
    }

    if (iteration < budget.maxIterations && memory.searchesPerformed < budget.maxSearches) {
      const { gaps, followUp } = suggestFollowUpQueries(userQuery, memory);
      if (followUp.length) {
        yield { type: "research_gaps", gaps, followUpQueries: followUp.map((q) => q.q) };
        queries.push(...followUp);
      }
    }
  }

  const fetchLimit = Math.min(
    budget.maxPageFetches,
    memory.sources.filter((s) => s.fetchStatus === "snippet").length,
  );

  let fetched = 0;
  for (const source of memory.sources) {
    if (fetched >= fetchLimit) break;
    if (source.fetchStatus !== "snippet" || !source.url) continue;
    if (!/^https?:\/\//i.test(source.url)) continue;

    try {
      const html = await fetchPageHtml(source.url, {
        timeoutMs: config.searxng.fetchTimeoutMs,
      });
      const text = htmlToText(html);
      attachPageText(source, text);
      memory.pagesFetched += 1;
      fetched += 1;

      const media = harvestMediaFromHtml(memory, {
        html,
        pageUrl: source.url,
        sourceId: source.id,
        tierBudget: budget,
      });
      for (const asset of media) {
        yield { type: "research_media", media: asset };
      }
    } catch {
      source.fetchStatus = "failed";
    }
  }

  for (const source of memory.sources) {
    const claims = extractClaimsFromSource(source);
    memory.claims.push(...claims);
  }

  memory.contradictions = detectSimpleContradictions(memory.claims);
  for (const c of memory.contradictions) {
    yield { type: "research_contradiction", contradiction: c };
  }

  updateResearchSession(sessionId, {
    status: "synthesizing",
    source_count: memory.sources.length,
    search_count: memory.searchesPerformed,
  });

  yield { type: "status", phase: "research", message: "Classifying topic…" };

  const classification = await classifyResearchTopic(userQuery, {
    sources: memory.sources,
  });

  yield {
    type: "document_type",
    documentType: classification.documentType,
    templateLabel: classification.template.label,
    subjectLabel: classification.subjectLabel,
    confidence: classification.confidence,
  };

  yield {
    type: "status",
    phase: "research",
    message: `Formatting as ${classification.template.label}…`,
  };

  let markdown = await synthesizeResearchReport({
    userQuery,
    sources: memory.sources,
    claims: memory.claims,
    contradictions: memory.contradictions,
    brainBaseline,
    documentType: classification.documentType,
    template: classification.template,
    media: memory.media,
    tier: normalizedTier,
  });

  markdown = cleanResearchReportMarkdown(markdown);

  const assembled = assembleResearchDocument({
    userQuery,
    subjectLabel: classification.subjectLabel,
    documentType: classification.documentType,
    templateLabel: classification.template.label,
    markdown,
    media: memory.media,
    sources: memory.sources,
    tier: normalizedTier,
  });

  markdown = assembled.markdown;
  memory.media = assembled.media;

  const reportJson = buildResearchReportJson({
    sessionId,
    userQuery,
    tier: normalizedTier,
    plan,
    memory,
    markdown,
    document: assembled.document,
    classification: {
      documentType: classification.documentType,
      subjectLabel: classification.subjectLabel,
      confidence: classification.confidence,
    },
  });

  updateResearchSession(sessionId, {
    status: "done",
    report_markdown: markdown,
    report_json: JSON.stringify(reportJson),
    source_count: memory.sources.length,
    search_count: memory.searchesPerformed,
    completed_at: Date.now(),
  });

  yield {
    type: "research_report",
    sessionId,
    markdown,
    report: reportJson,
  };

  yield {
    type: "message",
    node: "research",
    content: markdown,
    sessionId,
    report: reportJson,
  };
}
