import type { EpubMetadata } from "../../types/epub";

const DC_NS = "http://purl.org/dc/elements/1.1/";

export function readEpubMetadata(metadataElement: Element): EpubMetadata {
  const read = (name: "title" | "creator") => {
    const element = metadataElement.getElementsByTagNameNS(DC_NS, name)[0]
      ?? metadataElement.getElementsByTagName(`dc:${name}`)[0];
    return (element?.textContent ?? "").replace(/\s+/g, " ").trim();
  };
  return { title: read("title"), creator: read("creator") };
}
