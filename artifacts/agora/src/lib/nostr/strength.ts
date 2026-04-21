import { zxcvbn, zxcvbnOptions } from "@zxcvbn-ts/core";
import * as zxcvbnCommonPackage from "@zxcvbn-ts/language-common";
import * as zxcvbnEnPackage from "@zxcvbn-ts/language-en";

let configured = false;
function configure() {
  if (configured) return;
  zxcvbnOptions.setOptions({
    translations: zxcvbnEnPackage.translations,
    graphs: zxcvbnCommonPackage.adjacencyGraphs,
    dictionary: {
      ...zxcvbnCommonPackage.dictionary,
      ...zxcvbnEnPackage.dictionary,
    },
  });
  configured = true;
}

export type StrengthResult = {
  score: 0 | 1 | 2 | 3 | 4;
  guessesLog10: number;
  feedback: { warning: string; suggestions: string[] };
  /** 0–100 percentage, primarily for the visual meter. */
  percent: number;
  acceptable: boolean;
};

export function estimateStrength(passphrase: string): StrengthResult {
  configure();
  if (!passphrase) {
    return {
      score: 0,
      guessesLog10: 0,
      feedback: { warning: "", suggestions: [] },
      percent: 0,
      acceptable: false,
    };
  }
  const result = zxcvbn(passphrase);
  const score = result.score as 0 | 1 | 2 | 3 | 4;
  const percent = Math.min(100, Math.round((score / 4) * 100));
  return {
    score,
    guessesLog10: result.guessesLog10,
    feedback: {
      warning: result.feedback.warning ?? "",
      suggestions: result.feedback.suggestions ?? [],
    },
    percent,
    acceptable: passphrase.length >= 12 && score >= 3,
  };
}
