import { hostnameOf, type SearchOptions, type SearchProvider, type SearchResult } from "./types";

// ---------------------------------------------------------------------------
// Mock search provider
//
// Returns plausible, idea-aware results so DeepSearch demos with no API key. The
// UI clearly labels these as demo data — the URLs are illustrative, not live.
// ---------------------------------------------------------------------------

export class MockSearchProvider implements SearchProvider {
  readonly id = "mock";
  readonly label = "Demo (offline)";
  readonly isMock = true;

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const q = query.toLowerCase();
    const topic = query
      .replace(
        /open source github project|dataset kaggle huggingface|research paper arxiv|existing solutions and competitors|research and academic papers|statistics and market/gi,
        "",
      )
      .trim();
    const slug = topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "topic";

    // Intent-specific results so resource queries land in the right bucket.
    if (/github|open source|repository|repo/.test(q)) {
      return finalize(
        [
          {
            title: `${capitalize(topic)} — open-source reference implementation`,
            url: `https://github.com/opensource/${slug}`,
            content: `A community project tackling ${topic}. Reference architecture, sample data, and an API. ~2.1k stars.`,
            score: 0.92,
          },
          {
            title: `awesome-${slug}`,
            url: `https://github.com/awesome/${slug}`,
            content: `A curated list of tools, papers, and datasets for ${topic}.`,
            score: 0.88,
          },
          {
            title: `${slug}-starter`,
            url: `https://github.com/starters/${slug}-starter`,
            content: `A minimal starter template to bootstrap a ${topic} project.`,
            score: 0.83,
          },
        ],
        options,
      );
    }
    if (/dataset|kaggle|huggingface|data set/.test(q)) {
      return finalize(
        [
          {
            title: `${capitalize(topic)} dataset`,
            url: `https://www.kaggle.com/datasets/${slug}`,
            content: `Labeled dataset for ${topic}, suitable for training and benchmarking.`,
            score: 0.9,
          },
          {
            title: `${slug} on Hugging Face`,
            url: `https://huggingface.co/datasets/${slug}`,
            content: `Community dataset and loaders for ${topic}.`,
            score: 0.86,
          },
        ],
        options,
      );
    }
    if (/paper|arxiv|academic|research/.test(q)) {
      return finalize(
        [
          {
            title: `A Survey of Approaches to "${topic}"`,
            url: `https://arxiv.org/abs/2404.${hash(slug)}`,
            content: `Academic survey reviewing methods for ${topic}, comparing accuracy, cost, and deployment trade-offs.`,
            score: 0.94,
          },
          {
            title: `Toward better ${topic}: a systematic review`,
            url: `https://www.semanticscholar.org/paper/${slug}`,
            content: `Systematic review of the literature on ${topic} and open research questions.`,
            score: 0.87,
          },
        ],
        options,
      );
    }

    // Default: a mixed set for general/DeepSearch queries.
    return finalize(
      [
        {
          title: `A Survey of Approaches to "${topic}"`,
          url: `https://arxiv.org/abs/2404.${hash(slug)}`,
          content: `Academic survey reviewing recent methods relevant to ${topic}, comparing accuracy, cost, and deployment trade-offs.`,
          score: 0.94,
        },
        {
          title: `${capitalize(topic)} — open-source implementation`,
          url: `https://github.com/opensource/${slug}`,
          content: `A community project tackling ${topic}. Includes a reference architecture and an API. ~2.1k stars.`,
          score: 0.9,
        },
        {
          title: `How startups are solving ${topic}`,
          url: `https://techcrunch.com/2024/solutions-for-${slug}`,
          content: `Market overview of companies addressing ${topic}, and where current products still fall short.`,
          score: 0.86,
        },
        {
          title: `${capitalize(topic)}: market size & key statistics`,
          url: `https://www.statista.com/topics/${slug}`,
          content: `Data on the scale of ${topic}, adoption trends, and projected growth.`,
          score: 0.82,
        },
        {
          title: `Best practices and pitfalls for ${topic}`,
          url: `https://dev.to/guides/${slug}`,
          content: `Practitioner guide covering common architectures, tooling, and mistakes teams make with ${topic}.`,
          score: 0.78,
        },
      ],
      options,
    );
  }
}

function finalize(
  templates: Array<Omit<SearchResult, "source">>,
  options: SearchOptions,
): SearchResult[] {
  return templates
    .slice(0, options.maxResults ?? 5)
    .map((t) => ({ ...t, source: hostnameOf(t.url) }));
}

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0xffff;
  return (10000 + (h % 90000)).toString();
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
