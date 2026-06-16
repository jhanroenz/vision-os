export {
  findProjectRoot,
  findProjectRoot as findPackageJsonRoot,
  detectProjectRoot,
  describeCodebase,
  describeCodebase as describeProjectContext,
  copyTemplateFiles,
  copyTemplateFiles as copyTemplate,
  getTemplatesDir,
  workspaceRelative,
  enrichWriteFileResult,
  buildCodebaseSnapshot,
} from "./codebase/context.js";
