// @vitest-environment happy-dom

import { act, renderHook } from "@testing-library/react";
import type { FormEvent } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EmailBrandProfile } from "@/features/emails/email-api";

import { useBrandPanelController } from "./brand-panel-controller";
import { useTwoFactorController } from "./two-factor-controller";

const doubles = vi.hoisted(() => ({
  updateBrand: { mutateAsync: vi.fn<(input: unknown) => Promise<EmailBrandProfile>>() },
  enable: vi.fn<(input: unknown) => Promise<unknown>>(),
  verify: vi.fn<(input: unknown) => Promise<unknown>>(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn<(message: string) => void>(),
    error: vi.fn<(message: string) => void>(),
  },
}));
vi.mock("@/features/emails/email-api", () => ({
  useUpdateEmailBrandProfile: () => doubles.updateBrand,
}));
vi.mock("@/auth-client", () => ({
  authClient: { twoFactor: { enable: doubles.enable, verifyTotp: doubles.verify } },
}));

const profile: EmailBrandProfile = {
  brandName: "Brand",
  companyDescription: "Description",
  tone: "Clear",
  logoAssetId: null,
  websiteUrl: "https://example.com",
  primaryColor: "#112233",
  backgroundColor: "#ffffff",
  textColor: "#000000",
  postalAddress: "Tokyo",
  updatedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useBrandPanelController", () => {
  it("stores the saved profile and clears the submission error", async () => {
    const saved = { ...profile, brandName: "Saved", updatedAt: "2026-08-23T00:00:00.000Z" };
    doubles.updateBrand.mutateAsync.mockResolvedValue(saved);
    const { result } = renderHook(() => useBrandPanelController(profile));

    await act(() => result.current.submit(submitEvent()));

    expect(result.current.profile).toEqual(saved);
    expect(result.current.error).toBe("");
    expect(result.current.busy).toBe(false);
  });

  it("retains the current profile and exposes a save failure", async () => {
    doubles.updateBrand.mutateAsync.mockRejectedValue(new Error("brand unavailable"));
    const { result } = renderHook(() => useBrandPanelController(profile));

    await act(() => result.current.submit(submitEvent()));

    expect(result.current.profile).toEqual(profile);
    expect(result.current.error).toBe("brand unavailable");
    expect(result.current.busy).toBe(false);
  });
});

describe("useTwoFactorController", () => {
  it("advances from setup to verified after Better Auth succeeds", async () => {
    doubles.enable.mockResolvedValue({
      data: { totpURI: "otpauth://totp/OpenEngage", backupCodes: ["backup-1"] },
      error: null,
    });
    doubles.verify.mockResolvedValue({ data: { status: true }, error: null });
    const { result } = renderHook(() => useTwoFactorController());

    await act(() => result.current.enable(formEvent("password", "secret")));
    await act(() => result.current.verify(formEvent("code", "123456")));

    expect(result.current.setup).toEqual({
      totpURI: "otpauth://totp/OpenEngage",
      backupCodes: ["backup-1"],
    });
    expect(result.current.verified).toBe(true);
    expect(result.current.error).toBe("");
  });

  it("keeps the setup phase and exposes a Better Auth failure", async () => {
    doubles.enable.mockResolvedValue({ data: null, error: { message: "invalid password" } });
    const { result } = renderHook(() => useTwoFactorController());

    await act(() => result.current.enable(formEvent("password", "wrong")));

    expect(result.current.setup).toBeNull();
    expect(result.current.verified).toBe(false);
    expect(result.current.error).toBe("invalid password");
    expect(doubles.enable).toHaveBeenCalledWith({ password: "wrong", issuer: "OpenEngage" });
  });
});

function submitEvent(): FormEvent<HTMLFormElement> {
  return { preventDefault: () => undefined } as FormEvent<HTMLFormElement>;
}

function formEvent(name: string, value: string): FormEvent<HTMLFormElement> {
  const form = document.createElement("form");
  const input = document.createElement("input");
  input.name = name;
  input.value = value;
  form.appendChild(input);
  return { preventDefault: () => undefined, currentTarget: form } as FormEvent<HTMLFormElement>;
}
