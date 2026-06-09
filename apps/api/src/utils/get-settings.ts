import { config } from "dotenv-mono";
import { isRegistrationUrlProtected } from "./check-registration-allowed";

config();

const DEFAULT_AI_PROVIDER = "gemini";
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const DEFAULT_AI_TASK_INTAKE_MAX_INPUT_CHARS = 20_000;
const DEFAULT_AI_TASK_INTAKE_MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function getAiTaskIntakeSettings() {
  const maxInputChars = Number.parseInt(
    process.env.AI_TASK_INTAKE_MAX_INPUT_CHARS ||
      String(DEFAULT_AI_TASK_INTAKE_MAX_INPUT_CHARS),
    10,
  );
  const maxImageBytes = Number.parseInt(
    process.env.AI_TASK_INTAKE_MAX_IMAGE_BYTES ||
      String(DEFAULT_AI_TASK_INTAKE_MAX_IMAGE_BYTES),
    10,
  );

  return {
    enabled: process.env.AI_TASK_INTAKE_ENABLED === "true",
    provider: process.env.AI_PROVIDER || DEFAULT_AI_PROVIDER,
    geminiApiKey: process.env.GEMINI_API_KEY || "",
    geminiModel: process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
    maxInputChars: Number.isFinite(maxInputChars)
      ? maxInputChars
      : DEFAULT_AI_TASK_INTAKE_MAX_INPUT_CHARS,
    maxImageBytes: Number.isFinite(maxImageBytes)
      ? maxImageBytes
      : DEFAULT_AI_TASK_INTAKE_MAX_IMAGE_BYTES,
  };
}

export function isAiTaskIntakeAvailable(): boolean {
  const aiTaskIntake = getAiTaskIntakeSettings();

  return (
    aiTaskIntake.enabled &&
    aiTaskIntake.provider === "gemini" &&
    Boolean(aiTaskIntake.geminiApiKey)
  );
}

function getSettings() {
  return {
    disableRegistration: process.env.DISABLE_REGISTRATION === "true",
    disablePasswordRegistration:
      process.env.DISABLE_PASSWORD_REGISTRATION === "true",
    isRegistrationUrlProtected: isRegistrationUrlProtected(),
    isDemoMode: process.env.DEMO_MODE === "true",
    hasSmtp:
      Boolean(process.env.SMTP_HOST) &&
      Boolean(process.env.SMTP_PORT) &&
      Boolean(process.env.SMTP_SECURE) &&
      Boolean(process.env.SMTP_USER) &&
      Boolean(process.env.SMTP_PASSWORD),
    hasGithubSignIn:
      Boolean(process.env.GITHUB_CLIENT_ID) &&
      Boolean(process.env.GITHUB_CLIENT_SECRET),
    hasGoogleSignIn:
      Boolean(process.env.GOOGLE_CLIENT_ID) &&
      Boolean(process.env.GOOGLE_CLIENT_SECRET),
    hasDiscordSignIn:
      Boolean(process.env.DISCORD_CLIENT_ID) &&
      Boolean(process.env.DISCORD_CLIENT_SECRET),
    hasCustomOAuth:
      Boolean(process.env.CUSTOM_OAUTH_CLIENT_ID) &&
      Boolean(process.env.CUSTOM_OAUTH_CLIENT_SECRET),
    hasAiTaskIntake: isAiTaskIntakeAvailable(),
  };
}

export default getSettings;
