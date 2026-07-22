import React, { useState } from 'react';

interface RadarDataPoint {
  axis: string;
  score: number;
  target: number;
}

interface SafetyRadarChartProps {
  data: RadarDataPoint[];
}

export const SafetyRadarChart: React.FC<SafetyRadarChartProps> = ({ data }) => {
  const [hoveredAxis, setHoveredAxis] = useState<RadarDataPoint | null>(null);
  const [showTarget, setShowTarget] = useState(true);

  // SVG Radar setup
  const cx = 200;
  const cy = 200;
  const maxRadius = 140;

  // 6 axes angles (starting top, 60 deg increments)
  // 0 deg = -90 in SVG space
  const getCoordinates = (index: number, total: number, value: number) => {
    const angle = (Math.PI * 2 * index) / total - Math.PI / 2;
    const r = (value / 100) * maxRadius;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    return { x, y, angle };
  };

  const currentPoints = data
    .map((item, idx) => {
      const { x, y } = getCoordinates(idx, data.length, item.score);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const targetPoints = data
    .map((item, idx) => {
      const { x, y } = getCoordinates(idx, data.length, item.target);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <section className="glass-card rounded-xl p-6 min-h-[460px] flex flex-col justify-between relative overflow-hidden">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h3 className="font-display text-lg font-semibold text-[#f0f0f0]">
            Safety Indicator Variance
          </h3>
          <p className="font-body text-xs text-[#c0c7d3] mt-0.5">
            Multi-vector security alignment vs target posture across 6 Copilot readiness dimensions.
          </p>
        </div>

        {/* Toggle Target Benchmark */}
        <button
          onClick={() => setShowTarget(!showTarget)}
          className={`px-3 py-1.5 rounded-md font-mono text-xs border transition-all flex items-center gap-2 ${
            showTarget
              ? 'bg-[#479ef5]/10 border-[#479ef5]/30 text-[#479ef5]'
              : 'bg-[#1a1a1a] border-[#2b2b2b] text-[#c0c7d3] hover:text-white'
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full ${
              showTarget ? 'bg-[#479ef5]' : 'bg-[#8a919d]'
            }`}
          />
          Target Benchmark {showTarget ? 'ON' : 'OFF'}
        </button>
      </div>

      <div className="flex-1 relative flex items-center justify-center py-2">
        <svg
          className="w-full max-w-[440px] h-[340px] overflow-visible"
          viewBox="0 0 400 400"
        >
          {/* Concentric Circle Grids */}
          {[35, 70, 105, 140].map((r, i) => (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={r}
              fill="transparent"
              stroke="#2b2b2b"
              strokeWidth="1"
              strokeDasharray={i === 3 ? 'none' : '3 3'}
            />
          ))}

          {/* Axis Radial Lines */}
          {data.map((_, i) => {
            const { x, y } = getCoordinates(i, data.length, 100);
            return (
              <line
                key={i}
                x1={cx}
                y1={cy}
                x2={x}
                y2={y}
                stroke="#2b2b2b"
                strokeWidth="1"
              />
            );
          })}

          {/* Target Benchmark Polygon */}
          {showTarget && (
            <polygon
              points={targetPoints}
              fill="rgba(71, 158, 245, 0.08)"
              stroke="#479ef5"
              strokeWidth="1.5"
              strokeDasharray="4 4"
            />
          )}

          {/* Actual Score Data Polygon */}
          <polygon
            points={currentPoints}
            fill="rgba(179, 136, 255, 0.25)"
            stroke="#b388ff"
            strokeWidth="2.5"
            className="transition-all duration-500"
          />

          {/* Interactive Vertex Data Points */}
          {data.map((item, i) => {
            const { x, y } = getCoordinates(i, data.length, item.score);
            const isHovered = hoveredAxis?.axis === item.axis;

            // Axis Label positioning with offset
            const labelCoord = getCoordinates(i, data.length, 122);
            let textAnchor: 'start' | 'middle' | 'end' = 'middle';
            if (labelCoord.x > cx + 20) textAnchor = 'start';
            if (labelCoord.x < cx - 20) textAnchor = 'end';

            return (
              <g key={item.axis}>
                {/* Vertex circle */}
                <circle
                  cx={x}
                  cy={y}
                  r={isHovered ? '7' : '4.5'}
                  fill="#b388ff"
                  stroke="#1a1a1a"
                  strokeWidth="2"
                  className="cursor-pointer transition-all duration-200 hover:scale-125"
                  onMouseEnter={() => setHoveredAxis(item)}
                  onMouseLeave={() => setHoveredAxis(null)}
                />

                {/* Axis Text Label */}
                <text
                  x={labelCoord.x}
                  y={labelCoord.y}
                  fontSize="11"
                  textAnchor={textAnchor}
                  fill={isHovered ? '#b388ff' : '#c0c7d3'}
                  className="font-mono uppercase transition-colors cursor-pointer select-none font-medium"
                  onMouseEnter={() => setHoveredAxis(item)}
                  onMouseLeave={() => setHoveredAxis(null)}
                >
                  {item.axis}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Floating Tooltip Box when hovering axis point */}
        {hoveredAxis && (
          <div className="absolute top-4 right-4 glass-card p-3 rounded-lg border border-[#b388ff]/40 shadow-xl z-20 pointer-events-none animate-fadeIn">
            <p className="font-mono text-xs font-semibold text-[#b388ff] uppercase">
              {hoveredAxis.axis}
            </p>
            <div className="flex items-center gap-4 mt-2 font-mono text-xs">
              <div>
                <span className="text-[#8a919d] block text-[10px]">CURRENT</span>
                <span className="text-white font-bold text-sm">
                  {hoveredAxis.score}/100
                </span>
              </div>
              <div>
                <span className="text-[#8a919d] block text-[10px]">TARGET</span>
                <span className="text-[#479ef5] font-bold text-sm">
                  {hoveredAxis.target}/100
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer Legend */}
      <div className="flex justify-center items-center gap-6 font-mono text-xs text-[#c0c7d3] pt-2 border-t border-[#2b2b2b]/50">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-[#b388ff]/30 border border-[#b388ff] rounded-xs" />
          <span>Current Readiness</span>
        </div>
        {showTarget && (
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-[#479ef5]/20 border border-[#479ef5] border-dashed rounded-xs" />
            <span>Target Goal</span>
          </div>
        )}
      </div>
    </section>
  );
};
