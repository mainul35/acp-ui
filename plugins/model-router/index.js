// Model router: before each message, a small model says what kind of work it is, and the session
// switches to the model best for that kind. The same idea, prompt and categories as the AI
// gateway's router (app/tools/router.py there), so the two agree on what a message is.

const CATEGORIES = ['code', 'vision', 'reasoning', 'long', 'general'];

// The gateway's CATEGORY_PROMPT, word for word apart from VISION: here a picture is decided without
// asking, so the small model is never asked about one.
const PROMPT = `You read a user's message and say what kind of work it asks for. Answer with one
word and nothing else.

CODE      - writing, reading, fixing, explaining or reviewing code, or anything about a program's
            behaviour: build errors, stack traces, configuration files, shell commands, SQL.
REASONING - it needs careful step-by-step thought before an answer is possible: maths, logic
            puzzles, planning, weighing options, working something out from given facts.
LONG      - it comes with, or is about, a long piece of text to read through: summarise this,
            what does this document say, go through this transcript.
GENERAL   - everything else: ordinary questions, explanations, writing, conversation.

Examples:
"Why does my Spring Boot app fail to start with a BeanCreationException?" -> CODE
"Write a function that merges two sorted lists" -> CODE
"If a train leaves at 3pm going 60mph, when does it arrive 200 miles away?" -> REASONING
"Should I use Postgres or MongoDB for this, and why?" -> REASONING
"Summarise the attached meeting notes" -> LONG
"What is the capital of Bangladesh?" -> GENERAL
"Write me a short poem about rain" -> GENERAL

Answer with one of: CODE, REASONING, LONG, GENERAL.`;

// The gateway's fallback words, for when the small model cannot be reached or says nothing useful
const CODE_WORDS = /\b(code|function|class|method|variable|compile|build|error|exception|stack ?trace|bug|debug|api|endpoint|database|query|sql|docker|container|kubernetes|yaml|json|regex|script|shell|python|java|javascript|typescript|rust|golang|spring|react|npm|maven|gradle|git|refactor|test|file|repo)\b/i;
const REASONING_WORDS = /\b(calculate|compute|solve|prove|derive|how many|how much|why (is|does|would)|compare|trade-?offs?|should i|which is better|plan|strategy|step by step)\b/i;
const LONG_WORDS = /\b(summari[sz]e|summary|tl;?dr|these notes|this document|this transcript|this article|go through|read through)\b/i;

function byWords(text) {
  if (CODE_WORDS.test(text)) return 'code';
  if (LONG_WORDS.test(text) || text.length > 4000) return 'long';
  if (REASONING_WORDS.test(text)) return 'reasoning';
  return 'general';
}

// When no model is chosen for a kind, one is picked by what the models say about themselves
const LOOKS_FOR = {
  vision: /\b(vision|image|images|picture|pictures|screenshot|sees|vl)\b/i,
  code: /\b(coder|coding|code)\b/i,
  reasoning: /\b(reason\w*|think\w*|largest|careful)\b/i,
  long: /\b(long|largest|128k|context)\b/i,
};

// A name says what a model is; a description may only mention it in passing ("long code changes"
// describes the 80B, while "Qwen3-Coder" is the coding model), so names are searched first.
function automatic(category, models) {
  const pattern = LOOKS_FOR[category];
  if (!pattern) return null;
  const found = models.find(m => pattern.test(`${m.name} ${m.modelId}`))
             || models.find(m => pattern.test(m.description || ''));
  return found ? found.modelId : null;
}

export function activate(api) {
  const setting = key => api.settings.get(key);

  async function classify(text) {
    const endpoint = String(setting('endpoint') || '').replace(/\/+$/, '');
    const model = String(setting('classifier') || '');
    if (!endpoint || !model) return { category: byWords(text), by: 'keywords' };
    const key = String(setting('apiKey') || '');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await api.http.fetch(`${endpoint}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify({
          model,
          stream: false,
          temperature: 0,
          max_tokens: 200,
          reasoning_effort: 'none',
          messages: [
            { role: 'system', content: PROMPT },
            { role: 'user', content: `Message: ${text.slice(0, 6000)}\n\nKind:` },
          ],
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`the small model answered HTTP ${response.status}`);
      const answer = (await response.json()).choices?.[0]?.message?.content || '';
      const words = answer.replace(/<think>[\s\S]*?<\/think>/g, '').toLowerCase().match(/[a-z]+/g) || [];
      const found = words.find(w => CATEGORIES.includes(w) && w !== 'vision');
      // GENERAL is the absence of a signal, so plain words that say otherwise beat it - as the
      // gateway does: asked "write me a python function", the small model says GENERAL
      if (!found || found === 'general') {
        const guess = byWords(text);
        return guess !== 'general' ? { category: guess, by: 'keywords' } : { category: 'general', by: model };
      }
      return { category: found, by: model };
    } catch (e) {
      return { category: byWords(text), by: 'keywords', problem: e.name === 'AbortError' ? 'the small model took too long' : e.message };
    } finally {
      clearTimeout(timer);
    }
  }

  api.hooks.beforePrompt(async context => {
    if (setting('enabled') === false) return;
    const models = api.session.models;
    if (models.length < 2) return;

    const hasPicture = context.attachments.some(a => a.block?.type === 'image');
    let decision;
    if (hasPicture) {
      decision = { category: 'vision', by: 'a picture is attached' };
    } else {
      api.ui.setStatus('Working out which model suits this…');
      decision = await classify(context.text);
    }

    const chosen = String(setting(`model_${decision.category}`) || '') || automatic(decision.category, models);
    const target = models.find(m => m.modelId === chosen);
    const note = setting('showNote') !== false;

    if (!target) {
      if (hasPicture && note) {
        context.notes.push('No model that sees pictures is set for the router; the picture went to the current model.');
      } else if (note && decision.problem) {
        context.notes.push(`Router: ${decision.problem}; kept the current model.`);
      }
      return;
    }
    if (target.modelId !== api.session.currentModelId) {
      api.ui.setStatus(`Switching to ${target.name}…`);
      await api.session.setModel(target.modelId);
    }
    if (note) {
      context.notes.push(`Routed to ${target.name} - ${decision.category}, decided by ${decision.by}`
        + (decision.problem ? ` (${decision.problem})` : ''));
    }
  });
}
