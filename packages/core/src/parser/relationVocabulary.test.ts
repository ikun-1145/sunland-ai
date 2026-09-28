import { describe, expect, it } from "vitest";
import { SEMANTIC_LEXICON } from "@/semantic/lexicon";
import { CoreRelations } from "@/types";
import { createParser } from "@/parser";
import {
  ADDITIONAL_RELATIONS,
  CANONICAL_RELATION_ALIASES,
  relationAliasesFor,
  relationAliasesLongestFirst,
} from "./relationVocabulary";

const parser = createParser();

/** Every relation entry the Semantic layer understands. */
const lexiconRelationEntries = SEMANTIC_LEXICON.filter(
  (entry) => entry.category === "relation",
);

describe("relation vocabulary is the single source of relation aliases", () => {
  it("covers every relation the Semantic lexicon declares", () => {
    for (const entry of lexiconRelationEntries) {
      expect(
        Object.prototype.hasOwnProperty.call(CANONICAL_RELATION_ALIASES, entry.canonical),
        `relation ${entry.canonical} (${entry.id}) is not in the vocabulary`,
      ).toBe(true);
    }
  });

  it("declares no relation the Semantic lexicon does not understand", () => {
    const knownCanonicals = new Set(
      lexiconRelationEntries.map((entry) => entry.canonical),
    );
    for (const relation of Object.keys(CANONICAL_RELATION_ALIASES)) {
      expect(knownCanonicals.has(relation), `vocabulary relation ${relation} is unknown to the lexicon`).toBe(true);
    }
  });

  it.each(lexiconRelationEntries.map((entry) => [entry.id, entry.canonical] as const))(
    "lexicon entry %s (%s) only adds aliases ON TOP of the vocabulary, never removes one",
    (_id, canonical) => {
      const entry = lexiconRelationEntries.find((candidate) => candidate.canonical === canonical)!;
      const vocabulary = relationAliasesFor(canonical);
      for (const alias of vocabulary) {
        expect(entry.aliases, `${canonical} lost vocabulary alias ${alias}`).toContain(alias);
      }
    },
  );

  it.each(lexiconRelationEntries.map((entry) => [entry.id, entry.canonical] as const))(
    "lexicon entry %s (%s) adds no alias outside the vocabulary except the documented ones",
    (id, canonical) => {
      const entry = lexiconRelationEntries.find((candidate) => candidate.canonical === canonical)!;
      const vocabulary = relationAliasesFor(canonical);
      // `是` is the discourse alias for is-a ("苏格拉底是人"); `是什么意思` and
      // `表示` are interrogative/verb readings of `意思是`. Everything else must
      // come from the shared table.
      const documentedExtras =
        id === "is-a"
          ? ["是"]
          : id === "means"
            ? ["是什么意思", "表示"]
            : [];
      const extras = entry.aliases.filter((alias) => !vocabulary.includes(alias));
      expect(extras.sort()).toEqual([...documentedExtras].sort());
    },
  );

  it("orders aliases longest first so a longer word is never cut into a shorter one", () => {
    for (const relation of Object.keys(CANONICAL_RELATION_ALIASES)) {
      const ordered = relationAliasesLongestFirst(relation);
      const lengths = ordered.map((alias) => alias.length);
      expect(lengths, `${relation} aliases are not longest-first`).toEqual(
        [...lengths].sort((left, right) => right - left),
      );
    }
  });
});

describe("every relation alias in the shared vocabulary is teachable", () => {
  // The A.3 defect: these aliases were understood by Semantic but could not be
  // parsed by the Legacy grammar, so `猫能飞` was `unknown` and `猫拥有爪子`
  // was stored as the corrupted fact `{猫拥, 有, 爪子}`.
  //
  // The contract under test is PARSER <-> LEXICON via the shared vocabulary.
  // Two lexicon aliases are deliberately NOT part of it:
  //   - `是` is the interrogative/discourse head (`是什么`) and is covered by
  //     the dedicated identity tests;
  //   - `是什么意思` and `表示` are read-only readings of `意思是` (a question
  //     form and a verb), which must not become teachable statements.
  const teachable = lexiconRelationEntries.flatMap((entry) =>
    relationAliasesFor(entry.canonical).map(
      (alias) => [entry.canonical, alias] as const,
    ),
  );

  it.each(teachable)(
    "teaches canonical '%s' from alias '%s' without corrupting the subject",
    (canonical, alias) => {
      const parsed = parser.parse(`猫${alias}尾巴`);
      expect(parsed.type, `"猫${alias}尾巴" did not parse as a teaching statement`).toBe("statement");
      if (parsed.type !== "statement") return;
      expect(parsed.relation).toBe(canonical);
      expect(parsed.subject).toBe("猫");
      expect(parsed.object).toBe("尾巴");
    },
  );

  it("keeps the lexicon-only readings read-only rather than teachable", () => {
    // `猫是什么意思尾巴` must not become a way to write the relation 意思是,
    // and `表示` is a reading of the verb, not a relation word a user teaches.
    expect(parser.parse("猫表示尾巴").type).not.toBe("statement");
  });
});

describe("substring relation conflicts (the silent-corruption defects)", () => {
  it("does not cut '拥有' into '拥' + '有'", () => {
    const parsed = parser.parse("猫拥有爪子");
    expect(parsed).toMatchObject({
      type: "statement",
      subject: "猫",
      relation: ADDITIONAL_RELATIONS.Has,
      object: "爪子",
    });
  });

  it("does not cut '具备' into '具' + '备'", () => {
    expect(parser.parse("猫具备爪子")).toMatchObject({
      type: "statement",
      subject: "猫",
      relation: ADDITIONAL_RELATIONS.Has,
      object: "爪子",
    });
  });

  it("does not cut '算是' into '算' + '是'", () => {
    expect(parser.parse("猫算是哺乳动物")).toMatchObject({
      type: "statement",
      subject: "猫",
      relation: CoreRelations.IsA,
      object: "哺乳动物",
    });
  });

  it("does not cut '归类为' or '是一种'", () => {
    expect(parser.parse("猫归类为哺乳动物")).toMatchObject({
      type: "statement",
      subject: "猫",
      relation: CoreRelations.IsA,
      object: "哺乳动物",
    });
    expect(parser.parse("猫是一种哺乳动物")).toMatchObject({
      type: "statement",
      subject: "猫",
      relation: CoreRelations.IsA,
      object: "哺乳动物",
    });
  });

  it("does not cut '能够' or '可以'", () => {
    expect(parser.parse("猫能够爬树")).toMatchObject({
      type: "statement",
      subject: "猫",
      relation: CoreRelations.Can,
      object: "爬树",
    });
    expect(parser.parse("猫可以爬树")).toMatchObject({
      type: "statement",
      subject: "猫",
      relation: CoreRelations.Can,
      object: "爬树",
    });
  });

  it("does not cut '指的是' into '指' + '是'", () => {
    expect(parser.parse("猫指的是家猫")).toMatchObject({
      type: "statement",
      subject: "猫",
      relation: ADDITIONAL_RELATIONS.Means,
      object: "家猫",
    });
  });

  it("keeps the identity relation distinct from the is-a aliases", () => {
    // `苏格拉底是人` is instance-of and must NOT be promoted to 属于.
    expect(parser.parse("苏格拉底是人")).toMatchObject({
      type: "statement",
      relation: CoreRelations.Is,
      object: "人",
    });
  });
});

describe("alias-based queries stay answerable", () => {
  it.each([
    ["猫位于哪里", CoreRelations.LocatedIn],
    ["猫在哪里", CoreRelations.LocatedIn],
    ["猫有什么", ADDITIONAL_RELATIONS.Has],
  ] as const)("parses '%s' as relation '%s'", (input, relation) => {
    expect(parser.parse(input)).toMatchObject({
      type: "query",
      subject: "猫",
      relation,
    });
  });
});
