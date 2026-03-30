export class LHSSampler {
  private dimensions: number
  private samples: number

  constructor(dimensions: number, samples: number) {
    this.dimensions = dimensions
    this.samples = samples
  }

  sample(): number[][] {
    const result: number[][] = []
    const stratifications: number[][] = []

    for (let d = 0; d < this.dimensions; d++) {
      const strata: number[] = []
      for (let s = 0; s < this.samples; s++) {
        strata.push((s + Math.random()) / this.samples)
      }
      this.shuffle(strata)
      stratifications.push(strata)
    }

    for (let s = 0; s < this.samples; s++) {
      const point: number[] = []
      for (let d = 0; d < this.dimensions; d++) {
        point.push(stratifications[d][s])
      }
      result.push(point)
    }

    return result
  }

  private shuffle(array: number[]): void {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const temp = array[i]
      array[i] = array[j]
      array[j] = temp
    }
  }

  sampleInRange(ranges: Array<[number, number]>): number[][] {
    const unitSamples = this.sample()
    return unitSamples.map((point) =>
      point.map((value, dim) => {
        const [min, max] = ranges[dim]
        return min + value * (max - min)
      })
    )
  }

  sampleWithConstraints(
    ranges: Array<[number, number]>,
    constraints: Array<(point: number[]) => boolean>
  ): number[][] {
    const allSamples = this.sampleInRange(ranges)
    return allSamples.filter((point) => constraints.every((c) => c(point)))
  }
}

export function createLHSSampler(
  dimensions: number,
  samples: number
): LHSSampler {
  return new LHSSampler(dimensions, samples)
}

export function lhsSampleUniform(
  dimensions: number,
  samples: number
): number[][] {
  const sampler = new LHSSampler(dimensions, samples)
  return sampler.sample()
}

export function lhsSampleBounded(
  bounds: Array<[number, number]>,
  samples: number
): number[][] {
  const sampler = new LHSSampler(bounds.length, samples)
  return sampler.sampleInRange(bounds)
}
