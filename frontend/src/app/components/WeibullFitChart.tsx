import React from 'react';
import {
  ComposedChart,
  Line,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts';

interface RawPoint {
  age: number;
  ay: string;
  pct_reported: number;
}

interface FittedPoint {
  age: number;
  fitted_pct: number;
}

interface WeibullFitData {
  theta: number;
  omega: number;
  sse: number;
  raw_points: RawPoint[];
  fitted_curve: FittedPoint[];
  error?: string;
}

interface WeibullFitChartProps {
  data: WeibullFitData;
}

export default function WeibullFitChart({ data }: WeibullFitChartProps) {
  if (!data) return null;
  
  if (data.error) {
    return (
      <div className="text-red-500 text-xs p-4 border border-red-500/20 bg-red-500/10 rounded">
        Error fitting Weibull Curve: {data.error}
      </div>
    );
  }

  // Combine raw points and fitted curve into a single array for Recharts ComposedChart
  // The XAxis will be continuous (type="number")
  const ages = Array.from(new Set([
    ...data.raw_points.map(p => p.age),
    ...data.fitted_curve.map(p => p.age)
  ])).sort((a, b) => a - b);
  
  const chartData = ages.map(age => {
    // Find all raw points for this age
    const rawAtAge = data.raw_points.filter(p => p.age === age);
    // Find fitted point for this age
    const fitAtAge = data.fitted_curve.find(p => p.age === age);
    
    // We can map multiple actual values to scatter using an array, but Recharts 
    // requires flat data for ComposedChart Scatter. 
    // Wait, to render multiple raw points per age, we need one object per point.
    // So the data source should just be the raw points, but the fitted curve must be drawn as a line.
    return null;
  }).filter(Boolean);

  // A better approach for ComposedChart:
  // Data array where each object has `age`, `pct_reported` (can be null), and `fitted_pct` (can be null).
  // Wait, if an age has multiple `pct_reported` (one for each AY), Recharts Scatter needs separate objects.
  
  const formattedData: any[] = [];
  
  data.raw_points.forEach(p => {
    // Add raw points with the fitted curve value at that age to draw the line correctly
    const fitAtAge = data.fitted_curve.find(f => f.age === p.age);
    formattedData.push({
      age: p.age,
      ay: p.ay,
      pct_reported: p.pct_reported * 100, // convert to percentage for display
      fitted_pct: fitAtAge ? fitAtAge.fitted_pct * 100 : null
    });
  });
  
  // Sort by age to ensure the Line is drawn correctly
  formattedData.sort((a, b) => a.age - b.age);

  return (
    <div className="bg-bg-1 border border-border rounded shadow p-4 mt-6">
      <div className="flex justify-between items-center mb-4 border-b border-border pb-3">
        <div>
          <h3 className="text-md font-bold text-text-main flex items-center gap-2">
            📊 Weibull Reporting Pattern Fit
          </h3>
          <p className="text-xs text-text-sub mt-1">
            Minimizing Sum of Squared Errors across the Percentage Developed Triangle.
          </p>
        </div>
        <div className="flex gap-4 text-xs font-mono bg-bg-2 p-2 rounded border border-border/50">
          <div className="flex flex-col">
            <span className="text-text-muted">THETA</span>
            <span className="text-accent">{data.theta.toFixed(4)}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-text-muted">OMEGA</span>
            <span className="text-accent">{data.omega.toFixed(4)}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-text-muted">SSE</span>
            <span className="text-text-main">{data.sse.toFixed(6)}</span>
          </div>
        </div>
      </div>

      <div className="h-72 w-full mt-4">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={formattedData}
            margin={{ top: 10, right: 30, left: 10, bottom: 20 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff15" vertical={false} />
            <XAxis 
              dataKey="age" 
              type="number"
              domain={['dataMin', 'dataMax']}
              stroke="#888888" 
              fontSize={11} 
              tickMargin={10}
              label={{ value: 'Development Month', position: 'insideBottom', offset: -10, fill: '#888888', fontSize: 11 }}
            />
            <YAxis 
              stroke="#888888" 
              fontSize={11}
              domain={[0, 105]}
              tickFormatter={(value) => `${value}%`}
              label={{ value: '% Reported', angle: -90, position: 'insideLeft', fill: '#888888', fontSize: 11 }}
            />
            <Tooltip
              contentStyle={{ backgroundColor: '#1A1A1A', borderColor: '#333333', fontSize: '11px', borderRadius: '6px' }}
              itemStyle={{ color: '#E5E5E5' }}
              formatter={(value: any, name: any) => {
                if (name === 'fitted_pct') return [`${value.toFixed(1)}%`, 'Fitted Curve'];
                if (name === 'pct_reported') return [`${value.toFixed(1)}%`, 'Actual Reported'];
                return [value, name];
              }}
              labelFormatter={(label) => `Age: ${label}`}
            />
            <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '15px' }} />
            <Scatter 
              name="Actual Reported" 
              dataKey="pct_reported" 
              fill="#FFD700" 
              opacity={0.6}
            />
            <Line 
              type="monotone" 
              dataKey="fitted_pct" 
              name="Fitted Weibull Curve" 
              stroke="#3b82f6" 
              strokeWidth={3}
              dot={false}
              activeDot={{ r: 6 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
