import type {
  DialogueIntent,
  TurnUnderstanding,
  UserMood,
} from "@/types";

/**
 * Temporary one-way adapters for persisted Stage 15 dialogue state and
 * existing renderers. They derive legacy labels only from TurnUnderstanding;
 * no downstream module re-reads raw input to classify the turn.
 */
export function dialogueIntentFromTurn(
  understanding: TurnUnderstanding,
): DialogueIntent {
  if (understanding.socialInteraction !== "none") {
    return understanding.socialInteraction;
  }
  switch (understanding.primaryIntent) {
    case "ask_help":
    case "request_action": return "command";
    case "vent": return "emotional_share";
    case "seek_validation": return "opinion_request";
    case "joke":
    case "seek_reaction": return "reaction";
    case "share_experience": return understanding.speechAct === "storytelling"
      ? "storytelling"
      : "casual_chat";
    case "continue_topic": return "casual_chat";
    case "provide_information":
      if (understanding.speechAct === "question") return "question";
      if (understanding.speechAct === "storytelling") return "storytelling";
      // Structured declaratives must remain on the established Parser write
      // path; free-form sharing resolves to share_experience instead.
      return "unknown";
    case null: return "unknown";
  }
}

export function userMoodFromTurn(
  understanding: TurnUnderstanding,
): UserMood {
  switch (understanding.emotionalState?.primary) {
    case "joy": return "happy";
    case "excitement": return "excited";
    case "sadness": return "sad";
    case "frustration": return "frustrated";
    case "fatigue": return "tired";
    case "anger": return "angry";
    case "confusion": return "confused";
    case "anxiety": return "anxious";
    case "playfulness": return "playful";
    case "neutral": return "neutral";
    case "unknown":
    case undefined: return "unknown";
  }
}
