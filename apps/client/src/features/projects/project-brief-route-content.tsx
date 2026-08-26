import { ProjectBriefDetailPage } from "./project-brief-pages";

export function ProjectBriefRouteContent({ id }: { id: string }) {
  return <ProjectBriefDetailPage key={id} id={id} />;
}
