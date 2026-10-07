import { AsyncLocalStorage } from "node:async_hooks";
import { marketOf, type CountryCode, type Market } from "./markets";

/**
 * The country a search is running for, available to every lookup it makes (map, Google, search
 * engines, phone numbers, web address guesses) without passing it through each call. Two searches
 * for different countries at the same time each see their own. Outside a search: India.
 */
const als = new AsyncLocalStorage<{ country: CountryCode }>();

export const withCountry = <T,>(country: CountryCode | undefined, fn: () => Promise<T>): Promise<T> => als.run({ country: country ?? "IN" }, fn);
export const currentCountry = (): CountryCode => als.getStore()?.country ?? "IN";
export const currentMarket = (): Market => marketOf(currentCountry());
/** Cache keys: unchanged for India (so saved checks still count), prefixed elsewhere. */
export const countryKey = (key: string): string => (currentCountry() === "IN" ? key : `${currentCountry()}|${key}`);
