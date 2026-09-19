import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SkillLoader } from "./loader.js";

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function makeTempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "kernifold-skills-"));
  tempDirectories.push(directory);
  return directory;
}

function writeSkill(
  baseDirectory: string,
  name: string,
  description: string,
  options: {
    whenToUse?: string;
    disableModelInvocation?: boolean;
    userInvocable?: boolean;
    body?: string;
  } = {},
): string {
  const skillDirectory = join(baseDirectory, ".skills", name);
  mkdirSync(skillDirectory, { recursive: true });
  writeFileSync(
    join(skillDirectory, "SKILL.md"),
    [
      "---",
      `name: ${name}`,
      `description: "${description}"`,
      ...(options.whenToUse ? [`when_to_use: '${options.whenToUse}'`] : []),
      ...(options.disableModelInvocation === undefined
        ? []
        : [`disable-model-invocation: ${options.disableModelInvocation}`]),
      ...(options.userInvocable === undefined ? [] : [`user-invocable: ${options.userInvocable}`]),
      "---",
      "",
      options.body ?? `# ${name}\n\n按既定流程执行。`,
    ].join("\n"),
  );
  return skillDirectory;
}

describe("SkillLoader", () => {
  it("advertises metadata without injecting full skill content", () => {
    const directory = makeTempDirectory();
    writeSkill(directory, "code-review", "审查代码", {
      whenToUse: "用户要求 review 时",
    });
    writeSkill(directory, "research", "技术调研");

    const loader = new SkillLoader(directory);
    expect(loader.load()).toHaveLength(2);
    expect(loader.get("code-review")?.whenToUse).toBe("用户要求 review 时");

    const prompt = loader.buildPromptSection();
    expect(prompt).toContain("code-review — 审查代码");
    expect(prompt).toContain("适用场景: 用户要求 review 时");
    expect(prompt).toContain("research — 技术调研");
    expect(prompt).not.toContain("按既定流程执行");
  });

  it("uses the whole file as content when frontmatter is absent", () => {
    const directory = makeTempDirectory();
    const skillDirectory = join(directory, ".skills", "plain");
    mkdirSync(skillDirectory, { recursive: true });
    writeFileSync(join(skillDirectory, "SKILL.md"), "# Plain\n\n直接执行。");

    const loader = new SkillLoader(directory);
    loader.load();

    expect(loader.get("plain")).toEqual({
      name: "plain",
      description: "",
      disableModelInvocation: false,
      userInvocable: true,
      content: "# Plain\n\n直接执行。",
      dirPath: skillDirectory,
    });
  });

  it("keeps model-invocable and user-invocable policies separate", () => {
    const directory = makeTempDirectory();
    writeSkill(directory, "manual-only", "manual", {
      disableModelInvocation: true,
    });
    writeSkill(directory, "model-only", "model", {
      userInvocable: false,
    });

    const loader = new SkillLoader(directory);
    loader.load();

    expect(loader.listModelInvocable().map(({ name }) => name)).toEqual(["model-only"]);
    expect(loader.listUserInvocable().map(({ name }) => name)).toEqual(["manual-only"]);
  });

  it("expands the skill directory and passes explicit arguments on demand", () => {
    const directory = makeTempDirectory();
    const skillDirectory = writeSkill(directory, "code-review", "审查代码", {
      body: "读取 ${SKILL_DIR}/checklist.md。\n\n任务：$ARGUMENTS",
    });
    const loader = new SkillLoader(directory);
    loader.load();
    const skill = loader.get("code-review");
    expect(skill).toBeDefined();

    const content = loader.buildSkillContent(skill!, "检查 src/rag");

    expect(content).toContain(`${skillDirectory}/checklist.md`);
    expect(content).toContain("任务：检查 src/rag");
    expect(content).not.toContain("$ARGUMENTS");
  });
});
