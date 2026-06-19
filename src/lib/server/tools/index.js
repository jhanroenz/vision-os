import { createWebSearchTool } from "./webSearch.js";

import { readFileTool, writeFileTool, listDirectoryTool } from "./fileTools.js";

import { bashTool } from "./bashTool.js";

import { createRememberTool } from "./remember.js";

import { createLearnSkillTool } from "./learnSkill.js";

import { createRecallBrainTool } from "./recallBrain.js";

import { createCodebaseTools } from "./codebase.js";

import { verifyProjectTool } from "./verifyProject.js";

import { checkSyntaxTool } from "./checkSyntaxTool.js";
import { inspectAstTool } from "./inspectAstTool.js";

import { readLintsTool } from "./readLintsTool.js";

import { runCheckTool } from "./runCheckTool.js";

import { deleteFileTool } from "./deleteFileTool.js";

import { readFilesTool } from "./readFilesTool.js";

import { grepCodeTool } from "./grepTool.js";

import { globFilesTool } from "./globTool.js";

import { searchReplaceTool } from "./searchReplaceTool.js";

import { semanticSearchTool } from "./semanticSearchTool.js";

import { createSearchFilesTool } from "./searchFilesTool.js";

import { createCleanupStrayPathsTool } from "./cleanupStrays.js";

import { USER_APP_TOOLS } from "./userAppTools.js";

import { config } from "../config.js";

import { CASUAL_CHAT_TOOLS, PROFILE_TOOL_SETS, ASK_MODE_TOOLS } from "../turnIntent.js";



/** Prompt / bind order — AST exploration before full file reads. */
export const TOOL_PROMPT_ORDER = [
  "inspect_ast",
  "search_files",
  "inspect_codebase",
  "detect_stack",
  "grep_code",
  "glob_files",
  "semantic_search",
  "list_directory",
  "read_file",
  "read_files",
  "check_syntax",
  "read_lints",
  "write_file",
  "search_replace",
  "run_bash",
  "run_check",
  "verify_project",
  "delete_file",
  "web_search",
  "recall_brain",
  "remember",
  "learn_skill",
  "create_user_app",
  "import_user_app",
  "update_user_app_manifest",
  "publish_user_app",
  "list_user_apps",
  "set_app_data",
  "create_app_job",
];

export function sortToolsForPrompt(tools) {
  const order = new Map(TOOL_PROMPT_ORDER.map((name, index) => [name, index]));
  return [...tools].sort((a, b) => {
    const ai = order.get(a.name) ?? 500;
    const bi = order.get(b.name) ?? 500;
    return ai - bi || a.name.localeCompare(b.name);
  });
}

export function createTools(ctx = {}) {

  const tools = [

    createWebSearchTool(ctx),

    inspectAstTool,

    readFileTool,

    writeFileTool,

    searchReplaceTool,

    listDirectoryTool,

    bashTool,

    verifyProjectTool,

    checkSyntaxTool,

    readLintsTool,

    runCheckTool,

    deleteFileTool,

    readFilesTool,

    grepCodeTool,

    globFilesTool,

    createSearchFilesTool(ctx),

    semanticSearchTool,

    createCleanupStrayPathsTool(ctx),

    ...createCodebaseTools(ctx),

    createRememberTool(ctx),

    createLearnSkillTool(ctx),

    createRecallBrainTool(ctx),

    ...USER_APP_TOOLS,

  ];



  const intent = ctx.turnIntent;

  if (ctx.askMode || intent?.askMode) {
    return tools.filter((t) => ASK_MODE_TOOLS.has(t.name));
  }

  if (!intent) return tools;



  if (intent.casualChat) {

    return tools.filter((t) => CASUAL_CHAT_TOOLS.has(t.name));

  }



  const allowed = PROFILE_TOOL_SETS[intent.profile];

  if (allowed) {
    const names = new Set(allowed);
    if (intent.allowWebSearch) names.add("web_search");
    return tools.filter((t) => names.has(t.name));
  }



  return tools;

}

