import { PortfolioCard } from "@/components/portfolio-card"
import { PortfolioPositions } from "@/components/portfolio-positions"

export default function PortfolioPage() {
  return (
    <div className="mx-auto max-w-[90rem] px-6 py-6">
      <div className="flex gap-6">
        <div className="w-1/3">
          <PortfolioCard />
        </div>
        <div className="flex-1 min-w-0">
          <PortfolioPositions />
        </div>
      </div>
    </div>
  )
}
